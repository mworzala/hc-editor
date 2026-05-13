import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'

import {
    ApiError,
    useHCClient,
    v1ProjectEvents,
    v1ProjectFilesGetKey,
    v1ProjectGetKey,
    type ProjectEventEnvelope,
} from '@hollowcube/api'

import { useDocumentStore } from '../documents'

// Subscribes to the project events SSE stream and exposes connection state for
// the connection indicator. Each event:
//
//  • Invalidates the project metadata query so the file tree refreshes.
//
//  • If an open document's path matches the event AND the doc is clean,
//    invalidates that file's content query so the open editor refetches.
//    Dirty documents are intentionally untouched — conflict resolution is
//    out of scope here.
//
// Reconnect policy: AbortError exits cleanly; ApiError (HTTP response error)
// stops the stream and surfaces the failure for manual retry; everything else
// (network drop, parse failure) reconnects with exponential backoff using
// `Last-Event-ID` for resume.

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type ProjectConnection = {
    status: ConnectionStatus
    lastEventId?: string
    /** `Date.now()` at the moment the last event landed. Falsey until first event. */
    lastEventAt?: number
    error?: unknown
    /** Re-arm the events effect after a fatal stop. */
    retry: () => void
}

type StreamState = {
    status: ConnectionStatus
    lastEventId?: string
    lastEventAt?: number
    error?: unknown
    /** Bumped by `retry()` to force the effect to re-run after a manual retry. */
    nonce: number
}

type StreamAction =
    | { type: 'connecting' }
    | { type: 'connected' }
    | { type: 'event'; id: string }
    | { type: 'reconnecting' }
    | { type: 'error'; error: unknown }
    | { type: 'idle' }
    | { type: 'retry' }

function streamReducer(state: StreamState, action: StreamAction): StreamState {
    switch (action.type) {
        case 'connecting':
            return { ...state, status: 'connecting', error: undefined }
        case 'connected':
            return { ...state, status: 'connected', error: undefined }
        case 'event':
            return {
                ...state,
                status: 'connected',
                lastEventId: action.id,
                lastEventAt: Date.now(),
                error: undefined,
            }
        case 'reconnecting':
            return { ...state, status: 'reconnecting' }
        case 'error':
            return { ...state, status: 'error', error: action.error }
        case 'idle':
            return { ...state, status: 'idle' }
        case 'retry':
            return { ...state, status: 'connecting', error: undefined, nonce: state.nonce + 1 }
    }
}

const ProjectConnectionContext = createContext<ProjectConnection | null>(null)

type ProjectEventsProviderProps = {
    projectId: string
    children: ReactNode
}

export function ProjectEventsProvider({ projectId, children }: ProjectEventsProviderProps) {
    const client = useHCClient()
    const queryClient = useQueryClient()
    const documentStore = useDocumentStore()

    const [state, dispatch] = useReducer(streamReducer, {
        status: 'idle',
        nonce: 0,
    })

    // Keep the latest lastEventId in a ref so reconnects always pick up the
    // most recent id without making the effect re-run on every event.
    const lastEventIdRef = useRef<string | undefined>(undefined)
    lastEventIdRef.current = state.lastEventId

    useEffect(() => {
        const ac = new AbortController()
        let cancelled = false
        let attempt = 0

        async function run() {
            // eslint-disable-next-line no-unmodified-loop-condition -- cancelled is flipped by the cleanup callback below
            while (!cancelled) {
                dispatch({ type: attempt === 0 ? 'connecting' : 'reconnecting' })
                try {
                    const stream = v1ProjectEvents(client, projectId, {
                        lastEventId: lastEventIdRef.current,
                        signal: ac.signal,
                    })
                    // Mark connected as soon as the iterator hands us anything
                    // — practically, on the first event. SSE doesn't surface
                    // a separate "connected" signal otherwise.
                    let receivedFirst = false
                    dispatch({ type: 'connected' })
                    for await (const evt of stream) {
                        if (cancelled) break
                        receivedFirst = true
                        attempt = 0
                        applyEvent(evt, queryClient, documentStore, projectId)
                        dispatch({ type: 'event', id: evt.id })
                    }
                    // Stream ended without an error and without an abort —
                    // treat as a soft disconnect and reconnect.
                    if (cancelled) break
                    void receivedFirst
                    attempt += 1
                    await wait(backoffMs(attempt), ac.signal)
                } catch (e) {
                    if (cancelled || isAbortError(e)) break
                    if (e instanceof ApiError) {
                        dispatch({ type: 'error', error: e })
                        return
                    }
                    attempt += 1
                    dispatch({ type: 'reconnecting' })
                    try {
                        await wait(backoffMs(attempt), ac.signal)
                    } catch {
                        break
                    }
                }
            }
        }

        void run()

        return () => {
            cancelled = true
            ac.abort()
        }
        // Re-run when projectId changes or when retry() bumps the nonce.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, projectId, state.nonce])

    const retry = useCallback(() => dispatch({ type: 'retry' }), [])

    const value = useMemo<ProjectConnection>(
        () => ({
            status: state.status,
            lastEventId: state.lastEventId,
            lastEventAt: state.lastEventAt,
            error: state.error,
            retry,
        }),
        [state.status, state.lastEventId, state.lastEventAt, state.error, retry],
    )

    return (
        <ProjectConnectionContext.Provider value={value}>
            {children}
        </ProjectConnectionContext.Provider>
    )
}

export function useProjectConnection(): ProjectConnection {
    const ctx = useContext(ProjectConnectionContext)
    if (!ctx) {
        throw new Error('useProjectConnection must be used inside <ProjectEventsProvider>')
    }
    return ctx
}

// --- helpers ---

type QueryClientLike = ReturnType<typeof useQueryClient>
type DocStoreLike = ReturnType<typeof useDocumentStore>

function applyEvent(
    evt: ProjectEventEnvelope,
    queryClient: QueryClientLike,
    documentStore: DocStoreLike,
    projectId: string,
) {
    queryClient.invalidateQueries({ queryKey: v1ProjectGetKey(projectId) })
    const docs = documentStore.getState().documents
    const matching = docs[evt.path]
    if (matching && !matching.dirty) {
        queryClient.invalidateQueries({ queryKey: v1ProjectFilesGetKey(projectId, evt.path) })
    }
}

function backoffMs(attempt: number): number {
    const base = Math.min(30_000, 500 * 2 ** (attempt - 1))
    const jitter = Math.random() * 250
    return base + jitter
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(t)
            reject(new DOMException('aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

function isAbortError(e: unknown): boolean {
    return (
        typeof e === 'object' &&
        e !== null &&
        'name' in e &&
        (e as { name: unknown }).name === 'AbortError'
    )
}
