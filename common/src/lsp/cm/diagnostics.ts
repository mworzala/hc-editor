import { linter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint'
import { ViewPlugin, type EditorView } from '@codemirror/view'
import type { Diagnostic } from 'vscode-languageserver-types'

import { type LspClient } from '../LspClient'
import { rangeToOffsets } from './lspUtils'

// Suppress @codemirror/lint's built-in hover tooltip — our lspHover extension
// merges diagnostics into a single richer tooltip, and CM's default popping
// up alongside it gives the double-tooltip the user reported.
const suppressDefaultLintTooltip = linter(null, { tooltipFilter: () => [] })

const SEVERITY: Record<number, CmDiagnostic['severity']> = {
    1: 'error',
    2: 'warning',
    3: 'info',
    4: 'hint',
}

function toCmDiagnostics(view: EditorView, diagnostics: Diagnostic[]): CmDiagnostic[] {
    return diagnostics
        .map((d): CmDiagnostic | null => {
            const { from, to } = rangeToOffsets(view.state.doc, d.range)
            const finalTo = from === to ? Math.min(to + 1, view.state.doc.length) : to
            if (finalTo < from) return null
            return {
                from,
                to: finalTo,
                severity: SEVERITY[d.severity ?? 1] ?? 'error',
                message: d.message,
                source: d.source ?? 'luau',
            }
        })
        .filter((d): d is CmDiagnostic => d !== null)
}

export function lspDiagnostics(client: LspClient, uri: string) {
    const plugin = ViewPlugin.define((view) => {
        let destroyed = false
        const apply = (diags: Diagnostic[]) => {
            if (destroyed) return
            view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view, diags)))
        }
        // Replay any diagnostics the LSP client has already cached for this
        // URI. We defer this to a microtask so the dispatch lands AFTER the
        // view-plugin constructor returns — CM silently drops transactions
        // that race the initial view setup, which is exactly what happens
        // when an editor tab is re-mounted (tab switch) against a still-warm
        // LSP cache.
        queueMicrotask(() => {
            if (destroyed) return
            apply(client.getDiagnostics(uri))
        })
        // Subscribe for live updates. We DO NOT replay on subscribe here
        // (the queueMicrotask above already handles initial state) — the
        // listener fires only for subsequent publishes.
        const unsubscribe = client.onDiagnostics(
            (u, diags) => {
                if (u !== uri) return
                apply(diags)
            },
            { replay: false },
        )
        return {
            destroy() {
                destroyed = true
                unsubscribe()
            },
        }
    })
    return [suppressDefaultLintTooltip, plugin]
}
