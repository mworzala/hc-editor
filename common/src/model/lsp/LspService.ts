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

import type {
    CodeAction,
    CodeActionContext,
    Command,
    Diagnostic,
    Range,
    WorkspaceEdit,
} from 'vscode-languageserver-types'

import { stringTokenAt } from '../../editor/extensions/tokens'
import { runFormatOnView } from '../../editor/formatters/runFormat'
import { fileUriFromPath } from '../../editor/languages/luau-editor-services'
import type { EngineApiBundle } from '../../engine-api/bundle'
import { createApplyWorkspaceEditHandler } from '../../lsp/applyWorkspaceEdit'
import { offsetToPosition, rangeToOffsets } from '../../lsp/cm/lspUtils'
import { definitionFiles } from '../../lsp/definitionFiles'
import {
    applyEngineApiModules,
    docModuleAliases,
    docModuleLspFiles,
    docModules,
} from '../../lsp/docModules'
import { loadLuauFFlags } from '../../lsp/fflags'
import { LspClient, type LspState } from '../../lsp/LspClient'
import { LspUiBus } from '../../lsp/ui/lsp-ui-bus'
import { pathFromFileUri } from '../../lsp/uriResolver'
import { startWorkspaceDiagnosticPolling } from '../../lsp/workspaceDiagnostics'
import type { ActionRegistry } from '../actions/ActionRegistry'
import type { ActiveEditorRegistry } from '../active-editor/ActiveEditorRegistry'
import type { ContextService } from '../context/ContextService'
import { computed, effect, signal, type ReadonlySignal, type Signal } from '../foundation/signal'
import type { SearchService } from '../search/SearchService'
import type { TextModelService } from '../text-models/TextModelService'

/** LSP `PrepareRenameResult` covers three response shapes the server can
 *  send. `vscode-languageserver-types` doesn't ship a union for it, so we
 *  inline the discriminator here. */
type PrepareRenameResult =
    | (Range & { placeholder?: never })
    | { range: Range; placeholder: string }
    | { defaultBehavior: true }

export interface LspServiceDeps {
    textModels: TextModelService
    context: ContextService
    search?: SearchService
    /** Optional. When provided the service registers
     *  `editor.format` / `editor.codeAction` / `editor.rename`. */
    actions?: ActionRegistry
    /** Required when `actions` is provided. Action handlers resolve the
     *  focused editor entry via `activeEditor.activeDocId`. */
    activeEditor?: ActiveEditorRegistry
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
    private _stopBufferMirror: (() => void) | null = null
    private _worker: Worker | null = null
    private readonly _contextDisposers: Array<() => void> = []
    private readonly _actionDisposers: Array<() => void> = []
    private readonly _searchSourceDisposer: (() => void) | null
    private readonly _workerFactory: WorkerFactory
    private _disposed = false

    readonly status: ReadonlySignal<LspState> = this._status
    readonly client: ReadonlySignal<LspClient | null> = this._client

    /** Floating-UI bus for the code-action menu + rename prompt overlay.
     *  Lives on the service so action handlers (registered below) can
     *  open the UI without React indirection; the overlay component
     *  subscribes via `useLspUi(...)`. */
    readonly ui: LspUiBus = new LspUiBus()

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
        if (this.deps.actions) this._registerActions()
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

        // Mirror every open text model into the LSP via didOpen/didChange.
        // Lives on the service because the LSP keeps tracking a file once
        // opened — there is no per-tab refcount to mirror. The effect
        // auto-tracks the open-models registration and per-model content,
        // so any keystroke (or a new model opening) re-fires.
        this._stopBufferMirror = this._installBufferMirror(client)

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

    /** Install the open-buffer → LSP mirror. Lives on the service because
     *  the LSP keeps tracking a file once opened — there is no per-tab
     *  refcount to mirror. The effect auto-tracks the open-models
     *  registration and per-model content, so any keystroke (or a new
     *  model opening) re-fires this. */
    private _installBufferMirror(client: LspClient): () => void {
        const seenContent = new Map<string, string>()
        const stop = effect(() => {
            for (const model of this.deps.textModels.openModels.value) {
                if (!isLuauDocId(model.id)) continue
                const content = model.content.value
                const uri = fileUriFromPath(model.id)
                if (!seenContent.has(model.id)) {
                    seenContent.set(model.id, content)
                    client.openDocument(uri, 'luau', content)
                    continue
                }
                const prev = seenContent.get(model.id)
                if (prev !== content) {
                    seenContent.set(model.id, content)
                    client.didChange(uri, content)
                }
            }
        })
        return () => {
            stop()
            seenContent.clear()
        }
    }

    /** Stop the worker and clear state. Returns the underlying client's
     *  stop promise so callers can await full cleanup. Idempotent. */
    async stop(): Promise<void> {
        const client = this._client.peek()
        this._stopBufferMirror?.()
        this._stopBufferMirror = null
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
        for (const d of this._actionDisposers) d()
        this._actionDisposers.length = 0
        for (const d of this._contextDisposers) d()
        this._contextDisposers.length = 0
        this._searchSourceDisposer?.()
        this._diagnosticsByUri.clear()
    }

    // ----- Action handlers -----

    private _registerActions(): void {
        const { actions, activeEditor } = this.deps
        if (!actions || !activeEditor) return

        const focusedEntry = () => {
            const tabId = activeEditor.activeDocId.peek()
            if (!tabId) return null
            return activeEditor.get(tabId) ?? null
        }

        const runFormat = async () => {
            const entry = focusedEntry()
            if (!entry) return
            await runFormatOnView(entry.view, entry.language)
        }

        const runCodeAction = async () => {
            const entry = focusedEntry()
            if (!entry || !entry.lspUri) return
            const client = this._client.peek()
            if (!client || this._status.peek() !== 'running') return
            const { view, lspUri: uri } = entry
            const selection = view.state.selection.main
            const lspRange: Range = {
                start: offsetToPosition(view.state.doc, selection.from),
                end: offsetToPosition(view.state.doc, selection.to),
            }
            const overlapping = overlappingDiagnostics(client.getDiagnostics(uri), lspRange)
            const codeActionContext: CodeActionContext = {
                diagnostics: overlapping,
                only: undefined,
                triggerKind: 1,
            }
            let result: (CodeAction | Command)[] | null = null
            try {
                result = await client.sendRequest<(CodeAction | Command)[] | null>(
                    'textDocument/codeAction',
                    { textDocument: { uri }, range: lspRange, context: codeActionContext },
                )
            } catch (err) {
                console.warn('[lsp] codeAction failed', err)
                return
            }
            const items = (result ?? []).filter((a) => !(a as CodeAction).disabled) as (
                | CodeAction
                | Command
            )[]

            const coords = view.coordsAtPos(selection.head)
            const x = coords?.left ?? window.innerWidth / 2
            const y = (coords?.bottom ?? window.innerHeight / 2) + 4

            this.ui.openCodeActionMenu({
                x,
                y,
                items,
                onSelect: (item) => {
                    void applyCodeAction(client, item)
                },
            })
        }

        const runRename = async () => {
            const entry = focusedEntry()
            if (!entry || !entry.lspUri) return
            const client = this._client.peek()
            if (!client || this._status.peek() !== 'running') return
            const { view, lspUri: uri } = entry
            const head = view.state.selection.main.head
            const lspPos = offsetToPosition(view.state.doc, head)

            let initialName = ''
            let anchorOffset = head

            try {
                const prep = await client.sendRequest<PrepareRenameResult | null>(
                    'textDocument/prepareRename',
                    { textDocument: { uri }, position: lspPos },
                )
                if (prep) {
                    if ('placeholder' in prep && typeof prep.placeholder === 'string') {
                        initialName = prep.placeholder
                        const r = rangeToOffsets(view.state.doc, prep.range)
                        anchorOffset = r.from
                    } else if ('range' in prep) {
                        const r = rangeToOffsets(view.state.doc, (prep as { range: Range }).range)
                        anchorOffset = r.from
                        initialName = view.state.doc.sliceString(r.from, r.to)
                    } else if ('start' in prep && 'end' in prep) {
                        const r = rangeToOffsets(view.state.doc, prep as unknown as Range)
                        anchorOffset = r.from
                        initialName = view.state.doc.sliceString(r.from, r.to)
                    }
                }
            } catch {
                // Server doesn't support prepareRename — fall back to token at cursor.
            }

            if (!initialName) {
                const token = stringTokenAt(view, head)
                if (!token) return
                initialName = token.token
                anchorOffset = token.from
            }

            const coords = view.coordsAtPos(anchorOffset)
            const x = coords?.left ?? window.innerWidth / 2
            const y = (coords?.bottom ?? window.innerHeight / 2) + 4

            this.ui.openRenamePrompt({
                x,
                y,
                initialName,
                onConfirm: (newName) => {
                    void doRename(client, uri, lspPos, newName)
                },
            })
        }

        this._actionDisposers.push(
            actions.register({
                id: 'editor.format',
                title: 'Format document',
                group: 'edit',
                keybinding: '$mod+alt+l',
                when: 'editor.text',
                menu: { path: 'edit', group: 'format', order: 10 },
                run: () => {
                    void runFormat()
                },
            }),
            actions.register({
                id: 'editor.codeAction',
                title: 'Quick Fix / Refactor…',
                group: 'edit',
                keybinding: '$mod+.',
                when: 'editor.text && lsp.luau.running',
                run: () => {
                    void runCodeAction()
                },
            }),
            actions.register({
                id: 'editor.rename',
                title: 'Rename Symbol',
                group: 'edit',
                keybinding: 'f2',
                when: 'editor.text && lsp.luau.running',
                run: () => {
                    void runRename()
                },
            }),
        )
    }
}

function isLuauDocId(id: string): boolean {
    if (id.startsWith('unsaved:')) return false
    return id.endsWith('.luau') || id.endsWith('.lua')
}

function overlappingDiagnostics(diagnostics: readonly Diagnostic[], range: Range): Diagnostic[] {
    return diagnostics.filter((d) => rangesOverlap(d.range, range))
}

function rangesOverlap(a: Range, b: Range): boolean {
    if (cmp(a.end, b.start) < 0) return false
    if (cmp(b.end, a.start) < 0) return false
    return true
}

function cmp(a: { line: number; character: number }, b: { line: number; character: number }) {
    if (a.line !== b.line) return a.line - b.line
    return a.character - b.character
}

async function applyCodeAction(client: LspClient, item: CodeAction | Command): Promise<void> {
    const isCommand = !('kind' in item) && 'command' in item && typeof item.command === 'string'
    if (isCommand) {
        const cmd = item as Command
        try {
            await client.executeCommand(cmd.command, cmd.arguments)
        } catch (err) {
            console.warn('[lsp] executeCommand failed', err)
        }
        return
    }
    let action = item as CodeAction
    if (!action.edit && !action.command && action.data !== undefined) {
        try {
            const resolved = await client.sendRequest<CodeAction | null>(
                'codeAction/resolve',
                action,
            )
            if (resolved) action = resolved
        } catch (err) {
            console.warn('[lsp] codeAction/resolve failed', err)
            return
        }
    }
    if (action.edit) {
        await client.applyWorkspaceEdit(action.edit)
    }
    if (action.command) {
        try {
            await client.executeCommand(action.command.command, action.command.arguments)
        } catch (err) {
            console.warn('[lsp] code action command failed', err)
        }
    }
}

async function doRename(
    client: LspClient,
    uri: string,
    position: { line: number; character: number },
    newName: string,
): Promise<void> {
    let result: WorkspaceEdit | null = null
    try {
        result = await client.sendRequest<WorkspaceEdit | null>('textDocument/rename', {
            textDocument: { uri },
            position,
            newName,
        })
    } catch (err) {
        console.warn('[lsp] rename failed', err)
        return
    }
    if (!result) return
    await client.applyWorkspaceEdit(result)
}

// Re-export the fileUri helper so consumers can stay model-only.
export { fileUriFromPath }
