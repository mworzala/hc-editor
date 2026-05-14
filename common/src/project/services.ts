// ProjectServices — plain-TypeScript container for the model layer.
//
// Everything that's not a React component or pure rendering should be reachable
// from this object: language registry, document store, workspace store, LSP
// clients, action registry, etc. A single instance is created per loaded
// project and exposed to React via `ProjectServicesProvider`. Hooks like
// `useServices()` and feature-specific accessors (e.g. `useLuauLsp()`) read off
// it; they do NOT add reactive state of their own.
//
// Today this holds the Luau LSP slot and the action registry. Other
// subsystems (context keys, languages, documents, workspace) will migrate in
// here as their refactors land.

import { type LspClient, type LspState } from '../lsp/LspClient'
import { ContextKeys } from './actions/context-keys'
import { ActionRegistry } from './actions/registry-class'

export type LuauLspSnapshot = {
    status: LspState
    client: LspClient | null
}

const INITIAL_LUAU_SNAPSHOT: LuauLspSnapshot = { status: 'starting', client: null }

export class ProjectServices {
    /** Subsystem slots. Owned and mutated by their respective lifecycle hooks.
     *  Treat as readonly from the consumer side; mutations flow through the
     *  setter methods below so listeners can be notified. */
    readonly lsp = {
        luau: null as LspClient | null,
    }

    /** Plain-TS action registry shared between React (via
     *  `<ActionRegistryProvider registry={services.actions} />`) and any
     *  non-React consumer (tests, native menu bridge). */
    readonly actions = new ActionRegistry()

    /** Reactive context-key store. Producers (workspace, document store, LSP)
     *  write into it; consumers (action filter, menus) read from it. Replaces
     *  ad-hoc derivation from workspace state for new keys; the workspace
     *  derivation continues to feed the legacy tag set for backward compat. */
    readonly contextKeys = new ContextKeys()

    // ----- Luau LSP subscription -----

    private luauSnapshot: LuauLspSnapshot = INITIAL_LUAU_SNAPSHOT
    private luauListeners = new Set<() => void>()
    private luauClientUnsub: (() => void) | null = null

    /** Subscribe to changes in either the Luau LSP client or its status. */
    subscribeLuauLsp(cb: () => void): () => void {
        this.luauListeners.add(cb)
        return () => {
            this.luauListeners.delete(cb)
        }
    }

    /** Stable snapshot for `useSyncExternalStore`. */
    getLuauLspSnapshot(): LuauLspSnapshot {
        return this.luauSnapshot
    }

    /** Install (or clear) the Luau LSP client. Subscribes to its state-change
     *  stream so a status flip updates the snapshot and notifies listeners.
     *  Passing `null` detaches the client and resets the snapshot. Also
     *  mirrors the running/starting/failed state into context keys so actions
     *  with `contexts: ['lsp.luau.running']` become available/unavailable in
     *  step with the actual server. */
    setLuauClient(client: LspClient | null): void {
        if (this.luauClientUnsub) {
            this.luauClientUnsub()
            this.luauClientUnsub = null
        }
        this.lsp.luau = client
        if (client) {
            const initialStatus = client.getState()
            this.luauSnapshot = { status: initialStatus, client }
            this.syncLuauContextKey(initialStatus)
            this.luauClientUnsub = client.onStateChange((status) => {
                this.luauSnapshot = { status, client }
                this.syncLuauContextKey(status)
                this.emitLuau()
            })
        } else {
            this.luauSnapshot = INITIAL_LUAU_SNAPSHOT
            this.syncLuauContextKey(null)
        }
        this.emitLuau()
    }

    private syncLuauContextKey(status: LspState | null): void {
        this.contextKeys.set('lsp.luau.running', status === 'running')
        this.contextKeys.set('lsp.luau.starting', status === 'starting')
        this.contextKeys.set('lsp.luau.failed', status === 'failed')
    }

    private emitLuau(): void {
        for (const cb of this.luauListeners) cb()
    }

    // ----- Lifecycle -----

    /** Release subscriptions and per-subsystem resources. The host is
     *  responsible for stopping the actual LSP worker before calling this. */
    dispose(): void {
        if (this.luauClientUnsub) {
            this.luauClientUnsub()
            this.luauClientUnsub = null
        }
        this.lsp.luau = null
        this.luauSnapshot = INITIAL_LUAU_SNAPSHOT
        this.luauListeners.clear()
    }
}
