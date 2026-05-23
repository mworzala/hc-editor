// `EngineApiService` — owns the engine API bundle loading state machine.
// Replaces `<EngineApiProvider>`. The actual fetching is delegated to
// `loadEngineApiBundle()` from `common/src/engine-api/bundle.ts`, which
// retains its module-level promise cache so React StrictMode double-
// mounts and HMR don't re-hit the network.
//
// State machine: idle → loading → ready | error. `start()` triggers the
// fetch and is idempotent for the ready/loading states.

import { loadEngineApiBundle, type EngineApiBundle } from '../../engine-api/bundle'
import { findDocNode, findMember, type EngineApiMember } from '../../engine-api/lookup'
import type { EngineApiModule } from '../../engine-api/schema'
import { computed, signal, type ReadonlySignal } from '../foundation/signal'

export type EngineApiStatus =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; bundle: EngineApiBundle }
    | { kind: 'error'; error: unknown }

export interface EngineApiServiceDeps {
    /** Optional override for tests. Defaults to the production loader. */
    load?: () => Promise<EngineApiBundle>
}

export class EngineApiService {
    private readonly _status = signal<EngineApiStatus>({ kind: 'idle' })
    private readonly _load: () => Promise<EngineApiBundle>
    private _inflight = false
    private _disposed = false

    readonly status: ReadonlySignal<EngineApiStatus> = this._status
    readonly bundle: ReadonlySignal<EngineApiBundle | null> = computed(() => {
        const s = this._status.value
        return s.kind === 'ready' ? s.bundle : null
    })

    constructor(deps: EngineApiServiceDeps = {}) {
        this._load = deps.load ?? loadEngineApiBundle
    }

    /** Kick off the bundle fetch. Idempotent — no-op when already ready
     *  or in flight. Re-callable after `error` to retry. */
    start(): void {
        if (this._disposed) return
        const s = this._status.peek()
        if (s.kind === 'ready' || s.kind === 'loading') return
        if (this._inflight) return
        this._inflight = true
        this._status.value = { kind: 'loading' }
        this._load().then(
            (bundle) => {
                this._inflight = false
                if (this._disposed) return undefined
                this._status.value = { kind: 'ready', bundle }
                return undefined
            },
            (err: unknown) => {
                this._inflight = false
                if (this._disposed) return undefined
                console.error('[engine-api] load failed', err)
                this._status.value = { kind: 'error', error: err }
                return undefined
            },
        )
    }

    /** Resolve a module id to its doc node. Returns `undefined` when the
     *  bundle isn't ready or the module isn't known. */
    lookup(moduleId: string): EngineApiModule | undefined {
        const bundle = this.bundle.peek()
        if (!bundle) return undefined
        return findDocNode(bundle.doc, moduleId)
    }

    /** Look up a member by `module.symbol`. */
    lookupMember(moduleId: string, symbol: string): EngineApiMember | undefined {
        const node = this.lookup(moduleId)
        if (!node) return undefined
        return findMember(node, symbol)
    }

    dispose(): void {
        this._disposed = true
        this._status.value = { kind: 'idle' }
    }
}
