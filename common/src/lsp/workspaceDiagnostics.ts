import type { Diagnostic } from 'vscode-languageserver-types'

import { type LspClient } from './LspClient'

// Workspace-wide diagnostic pull. Push (`publishDiagnostics`) covers the open
// document; this fills in cross-file invalidations so a Problems panel can
// surface errors in files the user hasn't opened.
//
// Strategy: one poll on startup, one poll per `workspace/diagnostic/refresh`,
// and a single concurrent request at a time. Identical responses are detected
// via the `version` cursor luau-lsp ships back so we don't churn listeners.

type WorkspaceDiagnosticReport = {
    items: WorkspaceDocumentDiagnosticReport[]
}

type WorkspaceDocumentDiagnosticReport = {
    uri: string
    version: number | null
    kind: 'full' | 'unchanged'
    resultId?: string
    items?: Diagnostic[]
}

/** Start polling. Returns a cleanup that stops listening for refreshes. */
export function startWorkspaceDiagnosticPolling(client: LspClient): () => void {
    let inFlight = false
    let queued = false
    let cancelled = false
    const previousResultIds = new Map<string, string>()

    const runOnce = async () => {
        if (cancelled) return
        if (inFlight) {
            queued = true
            return
        }
        inFlight = true
        try {
            const previousResultArgs = [...previousResultIds.entries()].map(([uri, value]) => ({
                uri,
                value,
            }))
            const result = await client.sendRequest<WorkspaceDiagnosticReport | null>(
                'workspace/diagnostic',
                { previousResultIds: previousResultArgs },
            )
            if (cancelled) return
            if (result) {
                for (const item of result.items) {
                    if (item.kind !== 'full') continue
                    const items = item.items ?? []
                    client.setDiagnostics(item.uri, items)
                    if (item.resultId) previousResultIds.set(item.uri, item.resultId)
                }
            }
        } catch (err) {
            // Treat errors as "stop trying"; the server doesn't support it
            // or the worker is shutting down. Push diagnostics still flow.
            console.warn('[lsp] workspace/diagnostic failed', err)
            cancelled = true
            return
        } finally {
            inFlight = false
        }
        if (queued && !cancelled) {
            queued = false
            void runOnce()
        }
    }

    const unsubRefresh = client.onWorkspaceDiagnosticRefresh(() => {
        void runOnce()
    })

    // Kick off the initial pull. Wait a tick so capability negotiation has
    // settled — the server may otherwise reject the request as too early.
    const initialTimer = window.setTimeout(() => {
        if (!cancelled) void runOnce()
    }, 250)

    return () => {
        cancelled = true
        window.clearTimeout(initialTimer)
        unsubRefresh()
    }
}
