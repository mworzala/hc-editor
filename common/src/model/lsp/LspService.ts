// `LspService` — owns the Luau LSP worker, the `LspClient`, and a
// signal-based view of diagnostics. Replaces `<LuauLspProvider>` and the
// `lsp.luau` slot on `ProjectServices`.
//
// Lifecycle:
//   - constructed in the `stopped` status with `client = null`
//   - `start(bundle)` is called by `Project` once the `EngineApiBundle`
//     resolves: builds the worker, configures synthetic files + aliases,
//     instantiates `LspClient`, starts workspace-diagnostic polling
//   - `stop()` / `dispose()` tear down: stops polling, calls
//     `client.stop()`, terminates the worker, clears the signal cache
//
// Diagnostics surface:
//   - `diagnosticsForUri(uri)` returns a `ReadonlySignal<Diagnostic[]>`
//     lazily created the first time a consumer asks for it. The service
//     installs a single `onDiagnostics` listener on the `LspClient` and
//     fans out per-URI updates into the cached signals.
//   - `errorCountByPath` is a computed signal: project-relative path →
//     error count (severity 1). The file-tree row badges subscribe to
//     this.

import type { Diagnostic } from 'vscode-languageserver-types'

import { fileUriFromPath } from '../../editor/languages/luau-editor-services'
import type { EngineApiBundle } from '../../engine-api/bundle'
import { createApplyWorkspaceEditHandler } from '../../lsp/applyWorkspaceEdit'
import { definitionFiles } from '../../lsp/definitionFiles'
import {
    applyEngineApiModules,
    docModuleAliases,
    docModuleLspFiles,
    docModules,
} from '../../lsp/docModules'
import { loadLuauFFlags } from '../../lsp/fflags'
import { LspClient, type LspState } from '../../lsp/LspClient'
import { pathFromFileUri } from '../../lsp/uriResolver'
import { startWorkspaceDiagnosticPolling } from '../../lsp/workspaceDiagnostics'
import type { ContextService } from '../context/ContextService'
import {
    computed,
    signal,
    type ReadonlySignal,
    type Signal,
} from '../foundation/signal'
import type { SearchService } from '../search/SearchService'
import type { TextModelService } from '../text-models/TextModelService'

export interface LspServiceDeps {
    textModels: TextModelService
    context: ContextService
    search?: SearchService
}

type WorkerFactory = () => Worker

const defaultWorkerFactory: WorkerFactory = () =>
    new Worker(new URL('../../lsp/luau-lsp.worker.ts', import.meta.url), { type: 'module' })

export class LspService {
    private readonly _status = signal<LspState>('stopped')
    private readonly _client = signal<LspClient | null>(null)

    /** Per-URI diagnostic signals, lazily created on first access. The
     *  service installs a single client listener that writes into the
     *  appropriate signal here. */
    private readonly _diagnosticsByUri = new Map<string, Signal<readonly Diagnostic[]>>()
    private _stopDiagListener: (() => void) | null = null
    private _stopWorkspaceDiagPoll: (() => void) | null = null
    private _stopStateListener: (() => void) | null = null
    private _worker: Worker | null = null
    private readonly _contextDisposers: Array<() => void> = []
    private readonly _searchSourceDisposer: (() => void) | null
    private readonly _workerFactory: WorkerFactory
    private _disposed = false

    readonly status: ReadonlySignal<LspState> = this._status
    readonly client: ReadonlySignal<LspClient | null> = this._client

    /** Project-relative path → number of severity-1 (error) diagnostics.
     *  Walks the per-URI signal cache; recomputes when any cached signal
     *  changes (via `.value` reads). */
    readonly errorCountByPath: ReadonlySignal<ReadonlyMap<string, number>> = computed(() => {
        const out = new Map<string, number>()
        for (const [uri, sig] of this._diagnosticsByUri) {
            const diags = sig.value
            if (diags.length === 0) continue
            let errors = 0
            for (const d of diags) if ((d.severity ?? 1) === 1) errors++
            if (errors === 0) continue
            const raw = pathFromFileUri(uri)
            const path = raw.startsWith('/') ? raw.slice(1) : raw
            if (path) out.set(path, errors)
        }
        return out
    })

    constructor(
        private readonly deps: LspServiceDeps,
        opts?: { workerFactory?: WorkerFactory },
    ) {
        this._workerFactory = opts?.workerFactory ?? defaultWorkerFactory
        // Derived context keys mirror today's `setLuauClient` → ContextKeys
        // wiring. The `.value` reads run inside `derive`'s wrapping
        // `computed` callback so the tracking is intentional; lint:signals
        // can't see that lexically — escape hatch.
        this._contextDisposers.push(
            // lint:signals-ignore
            this.deps.context.derive('lsp.luau.running', () => this._status.value === 'running'),
            // lint:signals-ignore
            this.deps.context.derive('lsp.luau.starting', () => this._status.value === 'starting'),
            // lint:signals-ignore
            this.deps.context.derive('lsp.luau.failed', () => this._status.value === 'failed'),
        )
        this._searchSourceDisposer =
            this.deps.search?.register({ id: 'symbols', title: 'Symbols' }) ?? null
    }

    /** Return (lazy-create) the per-URI diagnostic signal. Consumers
     *  subscribe via `useSignal(...)` in React or `.value` inside a
     *  computed/effect. */
    diagnosticsForUri(uri: string): ReadonlySignal<readonly Diagnostic[]> {
        const cached = this._diagnosticsByUri.get(uri)
        if (cached) return cached
        const next = signal<readonly Diagnostic[]>([])
        this._diagnosticsByUri.set(uri, next)
        // Seed with any cached diagnostics already in the client.
        const client = this._client.peek()
        if (client) {
            const current = client.getDiagnostics(uri)
            if (current.length > 0) next.value = current
        }
        return next
    }

    /** Start the worker + LSP client. Idempotent: no-op when not
     *  `stopped`. */
    start(bundle: EngineApiBundle): void {
        if (this._disposed) return
        if (this._status.peek() !== 'stopped') return

        this._status.value = 'starting'
        applyEngineApiModules(bundle)

        const worker = this._workerFactory()
        this._worker = worker

        // .luaurc aliases — strip leading `@` and trailing `/`.
        const luaurcAliases: Record<string, string> = {}
        for (const [key, target] of Object.entries(docModuleAliases)) {
            const cleanKey = key.replace(/^@/u, '').replace(/\/$/u, '')
            luaurcAliases[cleanKey] = target
        }

        const syntheticFiles = [
            ...definitionFiles.map((f) => ({ path: f.path, content: f.content })),
            ...docModules.map((m) => ({ path: m.path, content: m.content })),
        ]

        worker.postMessage({
            __configure: true,
            aliases: luaurcAliases,
            syntheticFiles,
        })

        const client = new LspClient(worker)
        client.setApplyWorkspaceEditHandler(createApplyWorkspaceEditHandler(this.deps.textModels))
        this._client.value = client

        // Wire diagnostics → per-URI signals (single listener).
        this._stopDiagListener = client.onDiagnostics(
            (uri, diags) => {
                const sig = this._diagnosticsByUri.get(uri)
                if (sig) sig.value = [...diags]
                else this._diagnosticsByUri.set(uri, signal<readonly Diagnostic[]>([...diags]))
            },
            { replay: true },
        )

        // Mirror client state → service status signal.
        this._stopStateListener = client.onStateChange((state) => {
            this._status.value = state
        })
        // Pick up the initial state in case it's already past starting.
        this._status.value = client.getState()

        const files = docModuleLspFiles()
        const defFilePaths = definitionFiles.map((f) => f.path)

        void loadLuauFFlags()
            .then((fflags) =>
                client.start({
                    aliases: docModuleAliases,
                    files,
                    definitionFiles: defFilePaths,
                    fflags,
                    trace: 'off',
                }),
            )
            .then(() => {
                if (this._disposed) return undefined
                if (client.getState() === 'running') {
                    this._stopWorkspaceDiagPoll = startWorkspaceDiagnosticPolling(client)
                }
                return undefined
            })
            .catch((err: unknown) => {
                console.error('[luau-lsp] start failed', err)
                return undefined
            })
    }

    /** Stop the worker and clear state. Returns the underlying client's
     *  stop promise so callers can await full cleanup. Idempotent. */
    async stop(): Promise<void> {
        const client = this._client.peek()
        this._stopWorkspaceDiagPoll?.()
        this._stopWorkspaceDiagPoll = null
        this._stopDiagListener?.()
        this._stopDiagListener = null
        this._stopStateListener?.()
        this._stopStateListener = null
        if (client) {
            this._client.value = null
            try {
                await client.stop()
            } catch (err) {
                console.error('[luau-lsp] stop failed', err)
            }
        }
        if (this._worker) {
            this._worker.terminate()
            this._worker = null
        }
        // Clear per-URI signals so re-start doesn't carry stale diagnostics.
        for (const sig of this._diagnosticsByUri.values()) sig.value = []
        this._status.value = 'stopped'
    }

    dispose(): void {
        if (this._disposed) return
        this._disposed = true
        void this.stop()
        for (const d of this._contextDisposers) d()
        this._contextDisposers.length = 0
        this._searchSourceDisposer?.()
        this._diagnosticsByUri.clear()
    }
}

// Re-export the fileUri helper so consumers can stay model-only.
export { fileUriFromPath }
