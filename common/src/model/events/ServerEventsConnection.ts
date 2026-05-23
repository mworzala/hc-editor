// `ServerEventsConnection` — owns the SSE iterator over the project
// events stream + the connection status signals. Consolidates the
// pre-Phase-4 `<ProjectEventsProvider>` AND `<LspWatchedFilesBridge>`
// into one model-layer service.
//
// On each event:
//   1. `fileTree.refresh()` — re-fetch the bootstrap and re-install the
//      file map. Closes the Phase 3 regression where external file
//      changes no longer updated the tree.
//   2. `lsp.client.peek()?.didChangeWatchedFiles([{ uri, type: 2 }])` —
//      forward to the LSP so it re-analyses the file.
//   3. If a clean `TextModel` matches the path, fetch the bytes and
//      call `textModels.handleExternalChange(path, content)`. Dirty
//      models are intentionally untouched (conflict resolution lives in
//      `TextModelService` for explicit accept/keep flows).
//
// Reconnect policy: exponential backoff with jitter, `Last-Event-ID`
// resume, `ApiError` stops the stream (manual retry via `retry()`),
// `AbortError` exits cleanly. Mirrors today's events.tsx.

import {
    ApiError,
    v1MapEditorEvents,
    v1MapFilesGet,
    type HCClient,
    type MapEventEnvelope,
} from '@hollowcube/api'

import { fileUriFromPath } from '../../editor/languages/luau-editor-services'
import type { FileTreeService } from '../files/FileTreeService'
import { signal as createSignal, type ReadonlySignal } from '../foundation/signal'
import type { LspService } from '../lsp/LspService'
import type { TextModelService } from '../text-models/TextModelService'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type EventsStreamFactory = (
    client: HCClient,
    mapId: string,
    opts: { lastEventId?: string; signal: AbortSignal },
) => AsyncIterable<MapEventEnvelope>

export interface ServerEventsConnectionDeps {
    projectId: string
    client: HCClient
    fileTree: FileTreeService
    textModels: TextModelService
    lsp: LspService
    /** Test seam. Defaults to `v1MapEditorEvents`. */
    streamFactory?: EventsStreamFactory
    /** Test seam. Defaults to `v1MapFilesGet`. */
    fetchBytes?: typeof v1MapFilesGet
    /** When true, don't start the stream on construction. Tests use
     *  this to inspect the initial state without firing the IO loop. */
    autoStart?: boolean
}

export class ServerEventsConnection {
    private readonly _status = createSignal<ConnectionStatus>('idle')
    private readonly _lastEventId = createSignal<string | null>(null)
    private readonly _lastEventAt = createSignal<number | null>(null)
    private readonly _error = createSignal<unknown | null>(null)

    private _abort: AbortController | null = null
    private _disposed = false
    private _runId = 0

    readonly status: ReadonlySignal<ConnectionStatus> = this._status
    readonly lastEventId: ReadonlySignal<string | null> = this._lastEventId
    readonly lastEventAt: ReadonlySignal<number | null> = this._lastEventAt
    readonly error: ReadonlySignal<unknown | null> = this._error

    private readonly _streamFactory: EventsStreamFactory
    private readonly _fetchBytes: typeof v1MapFilesGet

    constructor(private readonly deps: ServerEventsConnectionDeps) {
        this._streamFactory = deps.streamFactory ?? v1MapEditorEvents
        this._fetchBytes = deps.fetchBytes ?? v1MapFilesGet
        if (deps.autoStart !== false) this._spawn()
    }

    /** Re-arm after a fatal `error` stop. Idempotent for non-error states. */
    retry(): void {
        if (this._disposed) return
        if (this._status.peek() !== 'error') return
        this._error.value = null
        this._spawn()
    }

    dispose(): void {
        if (this._disposed) return
        this._disposed = true
        this._abort?.abort()
        this._abort = null
    }

    // --- internals ---

    private _spawn(): void {
        if (this._disposed) return
        this._abort?.abort()
        const ac = new AbortController()
        this._abort = ac
        const runId = ++this._runId
        void this._run(ac, runId)
    }

    private async _run(ac: AbortController, runId: number): Promise<void> {
        let attempt = 0
        // eslint-disable-next-line no-unmodified-loop-condition -- cancelled checked via ac.signal.aborted
        while (!ac.signal.aborted && this._runId === runId) {
            this._status.value = attempt === 0 ? 'connecting' : 'reconnecting'
            try {
                const stream = this._streamFactory(this.deps.client, this.deps.projectId, {
                    lastEventId: this._lastEventId.peek() ?? undefined,
                    signal: ac.signal,
                })
                this._status.value = 'connected'
                for await (const evt of stream) {
                    if (ac.signal.aborted) break
                    attempt = 0
                    this._lastEventId.value = evt.id
                    this._lastEventAt.value = Date.now()
                    void this._applyEvent(evt.path)
                }
                if (ac.signal.aborted) break
                attempt += 1
                await wait(backoffMs(attempt), ac.signal)
            } catch (e) {
                if (ac.signal.aborted || isAbortError(e)) break
                if (e instanceof ApiError) {
                    this._error.value = e
                    this._status.value = 'error'
                    return
                }
                attempt += 1
                this._status.value = 'reconnecting'
                try {
                    await wait(backoffMs(attempt), ac.signal)
                } catch {
                    break
                }
            }
        }
    }

    private async _applyEvent(path: string): Promise<void> {
        // 1. Always refresh the file tree.
        void this.deps.fileTree.refresh().catch((err) => {
            console.warn('[events] fileTree.refresh failed', err)
        })
        // 2. Forward to LSP if running.
        const lspClient = this.deps.lsp.client.peek()
        if (lspClient) {
            lspClient.didChangeWatchedFiles([{ uri: fileUriFromPath(path), type: 2 }])
        }
        // 3. If an open clean TextModel matches, fetch the bytes and notify.
        const model = this.deps.textModels.get(path)
        if (!model || model.dirty.peek() || model.orphaned.peek()) return
        try {
            const bytes = await this._fetchBytes(this.deps.client, this.deps.projectId, path)
            const content = new TextDecoder('utf-8', { fatal: false }).decode(bytes.bytes)
            this.deps.textModels.handleExternalChange(path, content)
        } catch (err) {
            // 404 (deleted) is treated as an external delete.
            if (err instanceof ApiError && err.status === 404) {
                this.deps.textModels.handleExternalDelete(path)
                return
            }
            console.warn('[events] failed to fetch external change for', path, err)
        }
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
