// `EditorApp` — the process-wide root container.
//
// Phase 1 holds `platform`, `client`, and the currently-open `Project`.
// Phase 5 will lift `AuthService` onto this class (today the React-side
// `<AuthProvider>` still owns auth state and produces the `HCClient`; a
// short-lived bridge in `app-root.tsx` constructs `EditorApp` once auth
// has minted a client).
//
// `openProject(id)` disposes any previously-open project so callers don't
// have to coordinate cleanup. `closeProject()` is symmetric. The current
// project is exposed as a signal so reactive consumers (Phase 6 page
// shells) can observe project switches.

import type { HCClient } from '@hollowcube/api'

import type { Platform } from '../platform'
import { signal, type ReadonlySignal } from './foundation/signal'
import { Project } from './Project'

export interface EditorAppDeps {
    platform: Platform
    client: HCClient
}

export class EditorApp {
    readonly platform: Platform
    readonly client: HCClient

    private readonly _currentProject = signal<Project | null>(null)
    readonly currentProject: ReadonlySignal<Project | null> = this._currentProject

    constructor(deps: EditorAppDeps) {
        this.platform = deps.platform
        this.client = deps.client
    }

    openProject(projectId: string): Project {
        const prior = this._currentProject.peek()
        if (prior) {
            if (prior.projectId === projectId) return prior
            prior.dispose()
        }
        const next = new Project({
            projectId,
            platform: this.platform,
            client: this.client,
        })
        this._currentProject.value = next
        return next
    }

    closeProject(): void {
        const prior = this._currentProject.peek()
        if (!prior) return
        prior.dispose()
        this._currentProject.value = null
    }

    dispose(): void {
        this.closeProject()
    }
}
