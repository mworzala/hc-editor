// `EditorApp` — the process-wide root container.
//
// Owns `platform`, `auth` (the model-layer `AuthService`), and the
// currently-open `Project`. The wired `HCClient` lives inside `AuthService`;
// the `client` getter returns `this.auth.client` so consumers (`Project`
// deps, model services) reach the same authenticated client instance.

import type { HCClient } from '@hollowcube/api'

import type { Platform } from '../platform'
import type { WorkspaceState } from '../workspace/types'
import { AuthService } from './auth/AuthService'
import { signal, type ReadonlySignal } from './foundation/signal'
import { Project } from './Project'

export interface EditorAppDeps {
    platform: Platform
}

export interface OpenProjectOpts {
    /** Initial workspace layout used when no persisted blob exists. */
    initialLayout: WorkspaceState
}

export class EditorApp {
    readonly platform: Platform
    readonly auth: AuthService

    private readonly _currentProject = signal<Project | null>(null)
    readonly currentProject: ReadonlySignal<Project | null> = this._currentProject

    /** The auth-wired HCClient. Sourced from `AuthService` so the same
     *  client instance flows everywhere — DPoP, token refresh, the
     *  whole graph stays consistent. */
    get client(): HCClient {
        return this.auth.client
    }

    constructor(deps: EditorAppDeps) {
        this.platform = deps.platform
        this.auth = new AuthService({ platform: deps.platform })
    }

    openProject(projectId: string, opts: OpenProjectOpts): Project {
        const prior = this._currentProject.peek()
        if (prior) {
            if (prior.projectId === projectId) return prior
            prior.dispose()
        }
        const next = new Project({
            projectId,
            platform: this.platform,
            client: this.client,
            initialLayout: opts.initialLayout,
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
        this.auth.dispose()
    }
}
