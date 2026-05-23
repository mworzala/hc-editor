// `Project` — the per-open-project service container.
//
// Construction order is dependency order; `dispose()` runs in reverse so
// downstream services can still reach their deps while shutting down.
//
//   • Phase 1 — `context: ContextService`, `actions: ActionRegistry`
//   • Phase 2 — `layout: WorkspaceLayoutService`
//   • Phase 3 — `activeEditor`, `pendingFiles`, `fileTree`, `bootstrap`,
//               `textModels`
//   • Phase 4 — `search`, `languages`, `engineApi`, `lsp`, `events`

import type { HCClient } from '@hollowcube/api'

import { jsonLanguage } from '../editor/languages/json'
import { luauLanguage } from '../editor/languages/luau'
import type { Platform } from '../platform'
import type { WorkspaceState } from '../workspace/types'
import { ActionRegistry } from './actions/ActionRegistry'
import { ActiveEditorRegistry } from './active-editor/ActiveEditorRegistry'
import { ProjectBootstrap } from './bootstrap/ProjectBootstrap'
import { ContextService } from './context/ContextService'
import { EngineApiService } from './engine-api/EngineApiService'
import { ServerEventsConnection } from './events/ServerEventsConnection'
import { FileTreeService } from './files/FileTreeService'
import { PendingFilesService } from './files/PendingFilesService'
import { effect } from './foundation/signal'
import { LanguageService } from './languages/LanguageService'
import { LspService } from './lsp/LspService'
import { SearchService } from './search/SearchService'
import { TextModelService } from './text-models/TextModelService'
import { WorkspaceLayoutService } from './workspace/WorkspaceLayoutService'

export interface ProjectDeps {
    projectId: string
    platform: Platform
    client: HCClient
    /** Initial workspace layout used when no persisted blob exists (or it
     *  failed to load / failed validation). The caller owns the initial
     *  shape because tools and editors are registered host-side. */
    initialLayout: WorkspaceState
}

export class Project {
    readonly projectId: string
    readonly platform: Platform
    readonly client: HCClient
    readonly context: ContextService
    readonly actions: ActionRegistry
    readonly layout: WorkspaceLayoutService
    readonly activeEditor: ActiveEditorRegistry
    readonly pendingFiles: PendingFilesService
    readonly search: SearchService
    readonly languages: LanguageService
    readonly fileTree: FileTreeService
    readonly engineApi: EngineApiService
    readonly bootstrap: ProjectBootstrap
    readonly textModels: TextModelService
    readonly lsp: LspService
    readonly events: ServerEventsConnection
    private readonly _stopLspBundleEffect: () => void

    constructor(deps: ProjectDeps) {
        this.projectId = deps.projectId
        this.platform = deps.platform
        this.client = deps.client

        // Foundations (no deps).
        this.context = new ContextService()
        this.actions = new ActionRegistry({ context: this.context })
        this.layout = new WorkspaceLayoutService({
            storage: deps.platform.storage,
            storageKey: `hc-project:${deps.projectId}`,
            initialState: deps.initialLayout,
        })
        this.activeEditor = new ActiveEditorRegistry()
        this.pendingFiles = new PendingFilesService()
        this.search = new SearchService()
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
        })

        // Async subsystems.
        this.lsp = new LspService({
            textModels: this.textModels,
            context: this.context,
            search: this.search,
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

        // Kick off the bootstrap fetch.
        this.bootstrap.start()
    }

    dispose(): void {
        // Reverse construction order. Stop incoming traffic first.
        this.events.dispose()
        this._stopLspBundleEffect()
        this.lsp.dispose()
        this.textModels.dispose()
        this.bootstrap.dispose()
        this.engineApi.dispose()
        this.fileTree.dispose()
        this.languages.dispose()
        this.search.dispose()
        this.pendingFiles.dispose()
        this.activeEditor.dispose()
        this.layout.dispose()
        this.actions.dispose()
        this.context.dispose()
    }
}
