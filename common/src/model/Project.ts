// `Project` — the per-open-project service container.
//
// Construction order is dependency order; `dispose()` runs in reverse so
// downstream services can still reach their deps while shutting down.
//
// Foundations (`context`, `actions`) come first; layout, file/text data
// services, and async subsystems (search, LSP, SSE events) follow as
// later services depend on earlier ones.

import type { HCClient } from '@hollowcube/api'

import { jsonLanguage } from '../editor/languages/json'
import { luauLanguage } from '../editor/languages/luau'
import type { Platform } from '../platform'
import type { EditorGroupNode, Tab, WorkspaceState } from '../workspace/types'
import { ActionRegistry } from './actions/ActionRegistry'
import { ActiveEditorRegistry } from './active-editor/ActiveEditorRegistry'
import { ProjectBootstrap } from './bootstrap/ProjectBootstrap'
import { ContextService } from './context/ContextService'
import { DialogService } from './dialogs/DialogService'
import { EngineApiService } from './engine-api/EngineApiService'
import { ServerEventsConnection } from './events/ServerEventsConnection'
import { FileOperationsService } from './files/FileOperationsService'
import { FileTreeService } from './files/FileTreeService'
import { PendingFilesService } from './files/PendingFilesService'
import { effect } from './foundation/signal'
import { LanguageService } from './languages/LanguageService'
import { LspService } from './lsp/LspService'
import { NavigationService } from './navigation/NavigationService'
import type { AnyEditorMetadata, ToolMetadata } from './navigation/types'
import { SearchService } from './search/SearchService'
import { TextModelService } from './text-models/TextModelService'
import { findLeaf } from './workspace/tree-helpers'
import { WorkspaceLayoutService } from './workspace/WorkspaceLayoutService'

function toolKindContextKey(kind: string): string {
    // `tool:lsp-log` → `tool.lspLog`. Hyphens aren't legal in the
    // when-clause grammar's identifier production; camelCase the suffix.
    const slug = kind.startsWith('tool:') ? kind.slice('tool:'.length) : kind
    const camel = slug.replaceAll(/-([a-z])/gu, (_, c: string) => c.toUpperCase())
    return `tool.${camel}`
}

export interface ProjectDeps {
    projectId: string
    platform: Platform
    client: HCClient
    /** Initial workspace layout used when no persisted blob exists (or it
     *  failed to load / failed validation). The caller owns the initial
     *  shape because tools and editors are registered host-side. */
    initialLayout: WorkspaceState
    /** Tool metadata for the workspace.openTool action. Renders live
     *  host-side; the model only needs kind/title/defaultLocation. */
    tools: readonly ToolMetadata[]
    /** Editor metadata for the workspace.openEditor action. Renders live
     *  host-side; the model needs kind/mimeTypes/singleton/title routing. */
    editors: readonly AnyEditorMetadata[]
}

export class Project {
    readonly projectId: string
    readonly platform: Platform
    readonly client: HCClient
    readonly context: ContextService
    readonly actions: ActionRegistry
    readonly dialogs: DialogService
    readonly layout: WorkspaceLayoutService
    readonly activeEditor: ActiveEditorRegistry
    readonly pendingFiles: PendingFilesService
    readonly search: SearchService
    readonly languages: LanguageService
    readonly fileTree: FileTreeService
    readonly fileOperations: FileOperationsService
    readonly engineApi: EngineApiService
    readonly bootstrap: ProjectBootstrap
    readonly textModels: TextModelService
    readonly lsp: LspService
    readonly events: ServerEventsConnection
    readonly navigation: NavigationService
    private readonly _toolKinds: readonly string[]
    private readonly _stopLspBundleEffect: () => void
    private readonly _stopTextModelGC: () => void

    constructor(deps: ProjectDeps) {
        this.projectId = deps.projectId
        this.platform = deps.platform
        this.client = deps.client
        this._toolKinds = deps.tools.map((t) => t.kind)

        // Foundations (no deps).
        this.context = new ContextService()
        this.actions = new ActionRegistry({ context: this.context })
        this.dialogs = new DialogService()

        // One-shot static keys. `platform.desktop` gates desktop-only
        // actions (e.g. `editor.closeFocusedTab`).
        this.context.set('platform.desktop', deps.platform.kind === 'desktop')

        this.activeEditor = new ActiveEditorRegistry()
        this.layout = new WorkspaceLayoutService({
            storage: deps.platform.storage,
            storageKey: `hc-project:${deps.projectId}`,
            initialState: deps.initialLayout,
            actions: this.actions,
        })
        this.navigation = new NavigationService({
            actions: this.actions,
            layout: this.layout,
            tools: deps.tools,
            editors: deps.editors,
        })
        this.pendingFiles = new PendingFilesService()
        this.search = new SearchService({ actions: this.actions })
        this.languages = new LanguageService([jsonLanguage, luauLanguage])

        // Search-source registrations for the static slots. Domain
        // services with their own service registrations (LSP, EngineApi)
        // self-register on construction.
        this.search.register({ id: 'files', title: 'Files' })
        this.search.register({ id: 'text', title: 'Text' })
        this.search.register({ id: 'actions', title: 'Actions' })

        // Data services.
        this.fileTree = new FileTreeService({
            projectId: deps.projectId,
            client: deps.client,
        })
        this.engineApi = new EngineApiService()
        this.engineApi.start()
        this.bootstrap = new ProjectBootstrap({
            projectId: deps.projectId,
            client: deps.client,
            platform: deps.platform,
            fileTree: this.fileTree,
        })
        this.textModels = new TextModelService({
            projectId: deps.projectId,
            client: deps.client,
            fileTree: this.fileTree,
            pendingFiles: this.pendingFiles,
            actions: this.actions,
            activeEditor: this.activeEditor,
            layout: this.layout,
            dialogs: this.dialogs,
        })
        this.fileOperations = new FileOperationsService({
            projectId: deps.projectId,
            client: deps.client,
            fileTree: this.fileTree,
            pendingFiles: this.pendingFiles,
            textModels: this.textModels,
            layout: this.layout,
        })

        // Editor / workspace context-key derivations. Most keys are pure
        // functions of layout + textModels signals. lint:signals can't see
        // through the `derive` callback (which is wrapped in `computed`)
        // — the `.value` reads are intentional and tracked.
        this._installContextDerivations()

        // Async subsystems.
        this.lsp = new LspService({
            textModels: this.textModels,
            context: this.context,
            search: this.search,
            actions: this.actions,
            activeEditor: this.activeEditor,
        })
        // Kick off LSP exactly once when the engineApi bundle resolves.
        // `lsp.start(bundle)` is idempotent for the running/starting
        // states, so a duplicate fire is harmless. The effect stays live
        // for the project lifetime so a retry-from-error on EngineApi
        // would also trigger a fresh start.
        this._stopLspBundleEffect = effect(() => {
            const bundle = this.engineApi.bundle.value
            if (bundle) this.lsp.start(bundle)
        })

        this.events = new ServerEventsConnection({
            projectId: deps.projectId,
            client: deps.client,
            fileTree: this.fileTree,
            textModels: this.textModels,
            lsp: this.lsp,
        })

        // Text-model lifetime is layout-driven: the editor component never
        // closes the model on unmount, so this effect drops models that
        // are no longer referenced by any open `editor:text` tab.
        this._stopTextModelGC = this._installTextModelGC()

        // Kick off the bootstrap fetch.
        this.bootstrap.start()
    }

    dispose(): void {
        // Reverse construction order. Stop incoming traffic first.
        this.events.dispose()
        this._stopTextModelGC()
        this._stopLspBundleEffect()
        this.lsp.dispose()
        this.textModels.dispose()
        this.bootstrap.dispose()
        this.engineApi.dispose()
        this.fileTree.dispose()
        this.languages.dispose()
        this.search.dispose()
        this.pendingFiles.dispose()
        this.navigation.dispose()
        this.activeEditor.dispose()
        this.layout.dispose()
        this.dialogs.dispose()
        this.actions.dispose()
        this.context.dispose()
    }

    private _installContextDerivations(): void {
        const { context, layout, textModels, activeEditor } = this

        const focusedActiveTab = (): Tab | null => {
            // lint:signals-ignore
            const state = layout.state.value
            if (!state.focusedLeafId) return null
            const leaf = findLeaf(state.center, state.focusedLeafId)
            if (!leaf || !leaf.activeId) return null
            return leaf.tabs.find((t) => t.id === leaf.activeId) ?? null
        }

        context.derive('editor.focused', () => {
            const tab = focusedActiveTab()
            return tab !== null && !tab.kind.startsWith('tool:')
        })

        context.derive('editor.text', () => {
            const tab = focusedActiveTab()
            return tab?.kind === 'editor:text'
        })

        context.derive('editor.dirty', () => {
            // lint:signals-ignore
            const docId = activeEditor.activeDocId.value
            if (!docId) return false
            const model = textModels.get(docId)
            if (!model) return false
            // lint:signals-ignore
            return model.dirty.value
        })

        context.derive('editor.anyDirty', () => {
            // lint:signals-ignore
            return textModels.anyDirty.value
        })

        // tool.<kind> keys — true when the tool is mounted in any dock.
        // Driven from the host-supplied tool list; no second mirror to
        // keep in sync.
        for (const tool of this._toolKinds) {
            const key = toolKindContextKey(tool)
            context.derive(key, () => {
                // lint:signals-ignore
                const state = layout.state.value
                for (const dock of ['left', 'right', 'bottom'] as const) {
                    if (state[dock].tabs.some((t) => t.kind === tool)) return true
                }
                return false
            })
        }
    }

    private _installTextModelGC(): () => void {
        const { layout, pendingFiles, textModels } = this
        return effect(() => {
            const state = layout.state.value
            const pendingMap = pendingFiles.entries.value
            const live = new Set<string>()
            const visitTab = (tab: Tab): void => {
                if (tab.kind !== 'editor:text') return
                const docId = deriveTextDocIdFromTab(tab, pendingMap)
                if (docId) live.add(docId)
            }
            for (const dock of ['left', 'right', 'bottom'] as const) {
                for (const tab of state[dock].tabs) visitTab(tab)
            }
            walkLeavesIn(state.center, (leaf) => {
                for (const tab of leaf.tabs) visitTab(tab)
            })
            textModels.pruneToIds(live)
        })
    }
}

function walkLeavesIn(
    node: EditorGroupNode,
    visit: (leaf: Extract<EditorGroupNode, { kind: 'leaf' }>) => void,
): void {
    if (node.kind === 'leaf') {
        visit(node)
        return
    }
    walkLeavesIn(node.children[0], visit)
    walkLeavesIn(node.children[1], visit)
}

function deriveTextDocIdFromTab(
    tab: Tab,
    pendingMap: ReadonlyMap<string, { path: string | null }>,
): string | null {
    const payload = tab.payload as { path?: unknown; tempId?: unknown } | null | undefined
    const path = typeof payload?.path === 'string' ? payload.path : null
    const tempId = typeof payload?.tempId === 'string' ? payload.tempId : null
    if (path) return path
    if (tempId) {
        const pending = pendingMap.get(tempId)
        if (pending?.path) return pending.path
        return `unsaved:${tempId}`
    }
    return `unsaved:${tab.id}`
}
