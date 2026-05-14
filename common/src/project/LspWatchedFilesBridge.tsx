import { useEffect, useRef } from 'react'

import { v1ProjectEvents, useHCClient, type ProjectEventEnvelope } from '@hollowcube/api'

import { fileUriFromPath, useLuauLsp } from '../lsp'
import { useProject } from './context'

// Forward project event-stream notifications to the LSP via
// `workspace/didChangeWatchedFiles`. Each event arrives as a path; we cannot
// tell create vs. modify vs. delete from the envelope alone (the API contract
// is "refetch, 404 means deleted"), so every event is reported as Changed (2)
// — the LSP responds by re-analysing the URI in question. When a filesystem-
// watcher source materialises (planned desktop sync) it can call
// `client.didChangeWatchedFiles` directly with the right kind.
//
// We open our own SSE subscription rather than reading from
// `ProjectEventsProvider`, because that provider doesn't expose a per-event
// stream to subscribers — it only surfaces a connection-status indicator.
// Two streams to the same endpoint are cheap (the server multiplexes) and
// keeps the LSP wiring decoupled from the data layer.

export function LspWatchedFilesBridge() {
    const client = useHCClient()
    const project = useProject()
    const { client: lspClient, status } = useLuauLsp()
    const projectIdRef = useRef(project.id)
    projectIdRef.current = project.id

    useEffect(() => {
        if (!lspClient || status !== 'running') return
        const ac = new AbortController()
        let cancelled = false

        async function run() {
            // eslint-disable-next-line no-unmodified-loop-condition -- cancelled flipped by cleanup
            while (!cancelled) {
                try {
                    const stream = v1ProjectEvents(client, projectIdRef.current, {
                        signal: ac.signal,
                    })
                    for await (const evt of stream) {
                        if (cancelled) return
                        forward(evt, lspClient!)
                    }
                } catch (e) {
                    if (cancelled || isAbortError(e)) return
                    // Brief pause before reconnect so we don't spin on a
                    // persistent failure. Aligned with the existing
                    // ProjectEventsProvider behavior but simpler — this
                    // bridge is best-effort, not load-bearing.
                    await wait(2000, ac.signal).catch(() => {})
                }
            }
        }

        void run()
        return () => {
            cancelled = true
            ac.abort()
        }
    }, [client, lspClient, status])

    return null
}

function forward(evt: ProjectEventEnvelope, lspClient: NonNullable<ReturnType<typeof useLuauLsp>['client']>): void {
    const uri = fileUriFromPath(evt.path)
    // Server-supplied envelope has no kind discriminator; treat as Changed.
    // The client filters by glob via `getRegistrations(...)` before sending.
    lspClient.didChangeWatchedFiles([{ uri, type: 2 }])
}

function isAbortError(e: unknown): boolean {
    return (
        typeof e === 'object' &&
        e !== null &&
        'name' in e &&
        (e as { name: unknown }).name === 'AbortError'
    )
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
