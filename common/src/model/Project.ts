// `Project` — the per-open-project service container.
//
// Phase 1 holds only the two foundational services every later phase
// depends on: `ContextService` (for action when-clauses) and
// `ActionRegistry` (the command bus). Subsequent phases add:
//
//   • Phase 2 — `layout: WorkspaceLayoutService`
//   • Phase 3 — `bootstrap`, `fileTree`, `textModels`, `pendingFiles`,
//               `activeEditor`
//   • Phase 4 — `lsp`, `engineApi`, `events`, `search`, `languages`
//
// Disposal is reverse construction order: services that depend on others
// stop first so they can read their deps cleanly while shutting down.

import type { HCClient } from '@hollowcube/api'

import type { Platform } from '../platform'
import type { WorkspaceState } from '../workspace/types'
import { ActionRegistry } from './actions/ActionRegistry'
import { ContextService } from './context/ContextService'
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

    constructor(deps: ProjectDeps) {
        this.projectId = deps.projectId
        this.platform = deps.platform
        this.client = deps.client
        // Construction order matches dependency order; dispose runs in
        // reverse. `actions` depends on `context` (when-clause evaluation).
        this.context = new ContextService()
        this.actions = new ActionRegistry({ context: this.context })
        this.layout = new WorkspaceLayoutService({
            storage: deps.platform.storage,
            storageKey: `hc-project:${deps.projectId}`,
            initialState: deps.initialLayout,
        })
    }

    dispose(): void {
        // Reverse construction order. Later phases will add more services
        // above the foundational two; insert their disposals at the top
        // of this method.
        this.layout.dispose()
        this.actions.dispose()
        this.context.dispose()
    }
}
