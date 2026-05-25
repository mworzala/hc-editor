import type { Diagnostic } from 'vscode-languageserver-types'

import { type LspState, type LspClient } from '../../lsp/LspClient'
import { useSignal } from '../foundation/react'
import { useProject } from '../foundation/react'

export function useLsp() {
    return useProject().lsp
}

export function useLspStatus(): LspState {
    return useSignal(useProject().lsp.status)
}

export function useLspClient(): LspClient | null {
    return useSignal(useProject().lsp.client)
}

export function useDiagnosticsForUri(uri: string | null | undefined): readonly Diagnostic[] {
    const lsp = useProject().lsp
    const sig = uri ? lsp.diagnosticsForUri(uri) : EMPTY_DIAGS
    return useSignal(sig)
}

/** Project-relative paths that hold at least one error (severity 1).
 *  Re-renders when the underlying `errorCountByPath` map changes. */
export function useDiagnosticPaths(): ReadonlySet<string> {
    const counts = useSignal(useProject().lsp.errorCountByPath)
    return new Set(counts.keys())
}

/** Legacy compatibility shape — `useLuauLsp()` returned a
 *  `{ status, client }` object. Existing call sites stay readable. */
export type LuauLspSnapshot = {
    status: LspState
    client: LspClient | null
}

export function useLuauLsp(): LuauLspSnapshot {
    const status = useLspStatus()
    const client = useLspClient()
    return { status, client }
}

const EMPTY_DIAGS = {
    get value() {
        return EMPTY_ARRAY
    },
    peek: () => EMPTY_ARRAY,
    subscribe: () => () => {},
} as unknown as ReturnType<ReturnType<typeof useProject>['lsp']['diagnosticsForUri']>

const EMPTY_ARRAY: readonly Diagnostic[] = []
