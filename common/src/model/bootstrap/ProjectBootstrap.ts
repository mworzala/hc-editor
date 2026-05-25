// `ProjectBootstrap` — owns the editor-bootstrap fetch and the project
// metadata (`MapInfo`). State machine in signals:
//
//   idle → loading → loaded | error
//
// `start()` triggers the fetch. `Project` calls it on construction; it
// can be re-called on retry. Disposal aborts the in-flight request.
//
// On successful fetch, the response's `files` array is handed to
// `FileTreeService.installAll(...)` and the platform's window title is
// set. The React shell renders a loading / error / loaded gate by reading
// `status.value`.

import { v1MapEditorBootstrap, type HCClient, type MapInfo } from '@hollowcube/api'

import type { Platform } from '../../platform'
import type { FileTreeService } from '../files/FileTreeService'
import { computed, signal, type ReadonlySignal } from '../foundation/signal'

export type BootstrapStatus =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'loaded'; project: MapInfo }
    | { kind: 'error'; error: unknown }

export interface ProjectBootstrapDeps {
    projectId: string
    client: HCClient
    platform: Platform
    fileTree: FileTreeService
}

export class ProjectBootstrap {
    private readonly _status = signal<BootstrapStatus>({ kind: 'idle' })
    private _abort: AbortController | null = null

    /** Bootstrap state machine. UI gates render off `status.value.kind`. */
    readonly status: ReadonlySignal<BootstrapStatus> = this._status

    /** The project metadata once `status.kind === 'loaded'`, else `null`. */
    readonly project: ReadonlySignal<MapInfo | null> = computed(() => {
        const s = this._status.value
        return s.kind === 'loaded' ? s.project : null
    })

    constructor(private readonly deps: ProjectBootstrapDeps) {}

    /** Kick off the bootstrap fetch. Re-entrant: a second call replaces
     *  any in-flight request and a prior `error` state. Idempotent for
     *  the `loaded` state (no-op when already loaded for this project). */
    start(): void {
        if (this._status.peek().kind === 'loaded') return
        this._abort?.abort()
        const ac = new AbortController()
        this._abort = ac
        this._status.value = { kind: 'loading' }

        void v1MapEditorBootstrap(this.deps.client, this.deps.projectId, {
            signal: ac.signal,
        }).then(
            (data) => {
                if (ac.signal.aborted) return undefined
                this.deps.fileTree.installAll(data.files)
                this.deps.platform.setWindowTitle(data.map.name)
                this._status.value = { kind: 'loaded', project: data.map }
                return undefined
            },
            (error: unknown) => {
                if (ac.signal.aborted) return undefined
                this._status.value = { kind: 'error', error }
                return undefined
            },
        )
    }

    /** Force a refetch — used on retry. */
    retry(): void {
        this._status.value = { kind: 'idle' }
        this.start()
    }

    dispose(): void {
        this._abort?.abort()
        this._abort = null
    }
}
