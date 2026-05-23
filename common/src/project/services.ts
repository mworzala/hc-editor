// ProjectServices — plain-TypeScript container for the model layer.
//
// Today this holds the (legacy) action registry + context-keys store
// used by `NativeMenuBridge`, `ActionContextProvider`, etc. The LSP
// slot moved onto `Project.lsp` in Phase 4; the action / context-keys
// plumbing will follow in Phase 6 when the action registry is
// consolidated onto the model-layer `ActionRegistry`.

import type { LspClient, LspState } from '../lsp/LspClient'
import { ContextKeys } from './actions/context-keys'
import { ActionRegistry } from './actions/registry-class'

// Legacy type alias retained so existing imports keep compiling. The
// canonical snapshot now lives in `useLuauLsp()` from the model layer.
export type LuauLspSnapshot = {
    status: LspState
    client: LspClient | null
}

export class ProjectServices {
    /** Plain-TS action registry shared between React (via
     *  `<ActionRegistryProvider registry={services.actions} />`) and any
     *  non-React consumer (tests, native menu bridge). */
    readonly actions = new ActionRegistry()

    /** Reactive context-key store. Producers write into it; consumers
     *  (action filter, menus) read from it. */
    readonly contextKeys = new ContextKeys()

    dispose(): void {
        // No-op for now — the registry/context-keys are owned by the
        // host and don't need explicit teardown. The LSP slot
        // teardown moved to `LspService.dispose()` in Phase 4.
    }
}
