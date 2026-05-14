import { type Extension } from '@codemirror/state'
import type { Diagnostic } from 'vscode-languageserver-types'

import {
    fileUriFromPath,
    lspExtensions,
    resolveUri,
    runGotoDefinitionAtPos,
    type ReferenceMatch,
    type ResolvedUri,
} from '../../lsp'
import { DOCS_EDITOR_KIND } from '../../project/editors/docs-kind'
import { TEXT_EDITOR_KIND } from '../../project/editors/text-kind'
import { type UsageMatch } from '../components/UsagesPopup'
import {
    type DiagnosticCounts,
    type EditorServices,
    type LanguageEditorBinding,
    type LanguageEditorDeps,
} from './types'

// Builds a `LanguageEditorBinding` for the Luau LSP. All LSP-related imports
// live here, NOT in `text.tsx`.
//
// Subscription lifecycle is **lazy**: external LSP subscriptions (services'
// snapshot change, the client's diagnostic stream) are only attached while at
// least one consumer is subscribed via `subscribe()`. The first subscriber
// attaches; the last unsubscriber detaches. This pattern survives React's
// StrictMode dev double-mount, which would otherwise dispose the binding's
// subscriptions during the synthetic unmount and never reattach them.

const EMPTY_DIAGNOSTICS: DiagnosticCounts = {
    errors: 0,
    warnings: 0,
    infos: 0,
    hints: 0,
    total: 0,
}

function tallyDiagnostics(diags: readonly Diagnostic[]): DiagnosticCounts {
    let errors = 0
    let warnings = 0
    let infos = 0
    let hints = 0
    for (const d of diags) {
        switch (d.severity ?? 1) {
            case 1:
                errors++
                break
            case 2:
                warnings++
                break
            case 3:
                infos++
                break
            case 4:
                hints++
                break
        }
    }
    return { errors, warnings, infos, hints, total: errors + warnings + infos + hints }
}

const EMPTY_SNAPSHOT: EditorServices = {
    extensions: undefined,
    gotoDefinitionAt: undefined,
    diagnosticCounts: EMPTY_DIAGNOSTICS,
    suppressCmdClickUsages: false,
    suppressFoldGutter: false,
}

/** Construct a Luau LSP binding for a single editor tab. */
export function createLuauEditorBinding(deps: LanguageEditorDeps): LanguageEditorBinding {
    const { services, uri, knownPaths, openEditor, showUsages } = deps

    let snapshot: EditorServices = EMPTY_SNAPSHOT
    const listeners = new Set<() => void>()
    const notify = () => {
        for (const cb of listeners) cb()
    }

    // Extensions are stable per-client: rebuilding them on every snapshot
    // change would churn CodeMirror's reconfigure path. Cache against the
    // current client and only rebuild when the client identity changes.
    let cachedExtensions: Extension[] | null = null
    let cachedExtensionsClient: object | null = null

    const handleDefinitionOpen = (
        resolved: ResolvedUri,
        targetRange?: {
            start: { line: number; character: number }
            end: { line: number; character: number }
        },
    ) => {
        if (resolved.kind === 'file') {
            const payload: Record<string, unknown> = { path: resolved.path }
            if (targetRange) {
                payload.flashLspRange = {
                    startLine: targetRange.start.line,
                    startCharacter: targetRange.start.character,
                    endLine: targetRange.end.line,
                    endCharacter: targetRange.end.character,
                }
            }
            openEditor({ kind: TEXT_EDITOR_KIND, payload, identityKey: 'path' })
        } else if (resolved.kind === 'doc-module') {
            openEditor({
                kind: DOCS_EDITOR_KIND,
                payload: { moduleId: resolved.module.alias, kind: 'library' },
                identityKey: 'moduleId',
            })
        } else if (resolved.kind === 'definition-file') {
            openEditor({
                kind: DOCS_EDITOR_KIND,
                payload: { moduleId: resolved.file.alias, kind: 'definition-file' },
                identityKey: 'moduleId',
            })
        }
    }

    const handleShowReferences = (
        matches: ReferenceMatch[],
        anchorPos: number,
        sourceRange: { from: number; to: number },
    ) => {
        const usageMatches: UsageMatch[] = matches.map((m) => ({
            line: m.line,
            col: m.col,
            from: m.from,
            to: m.to,
            snippet: m.snippet,
        }))
        showUsages(usageMatches, anchorPos, sourceRange)
    }

    const resolveTargetUri = (targetUri: string) => resolveUri(targetUri, knownPaths)

    function rebuildSnapshot(): void {
        const { client, status } = services.getLuauLspSnapshot()
        if (!client) {
            snapshot = EMPTY_SNAPSHOT
            cachedExtensions = null
            cachedExtensionsClient = null
            return
        }

        if (cachedExtensionsClient !== (client as unknown as object)) {
            cachedExtensions = lspExtensions({
                client,
                uri,
                resolve: resolveTargetUri,
                onDefinitionOpen: handleDefinitionOpen,
                onShowReferences: handleShowReferences,
            }) as Extension[]
            cachedExtensionsClient = client as unknown as object
        }

        const running = status === 'running'
        const counts = tallyDiagnostics(client.getDiagnostics(uri))

        snapshot = {
            extensions: running ? (cachedExtensions ?? []) : [],
            gotoDefinitionAt: running
                ? (pos, view) => {
                      void runGotoDefinitionAtPos(
                          view,
                          client,
                          uri,
                          pos,
                          resolveTargetUri,
                          handleDefinitionOpen,
                          handleShowReferences,
                      )
                  }
                : undefined,
            diagnosticCounts: counts,
            suppressCmdClickUsages: running,
            suppressFoldGutter: running,
        }
    }

    // ---- lazy subscription lifecycle ----
    let lspUnsub: (() => void) | null = null
    let diagnosticsUnsub: (() => void) | null = null
    let currentDiagnosticsClient: object | null = null

    function attachDiagnosticsForCurrentClient(): void {
        const { client } = services.getLuauLspSnapshot()
        if (currentDiagnosticsClient === (client as unknown as object)) return
        if (diagnosticsUnsub) {
            diagnosticsUnsub()
            diagnosticsUnsub = null
        }
        if (!client) {
            currentDiagnosticsClient = null
            return
        }
        currentDiagnosticsClient = client as unknown as object
        // `replay: true` so any diagnostics published before the binding
        // subscribed (LSP indexed the file during the StrictMode synthetic
        // unmount, for instance) immediately flow through. The replay path
        // also handles the small race between `rebuildSnapshot()` and this
        // subscribe call — the replayed callback just re-emits the same data.
        diagnosticsUnsub = client.onDiagnostics(
            (u) => {
                if (u !== uri) return
                rebuildSnapshot()
                notify()
            },
            { replay: true },
        )
    }

    function attachAll(): void {
        if (lspUnsub) return // already attached
        rebuildSnapshot()
        attachDiagnosticsForCurrentClient()
        lspUnsub = services.subscribeLuauLsp(() => {
            attachDiagnosticsForCurrentClient()
            rebuildSnapshot()
            notify()
        })
    }

    function detachAll(): void {
        if (lspUnsub) {
            lspUnsub()
            lspUnsub = null
        }
        if (diagnosticsUnsub) {
            diagnosticsUnsub()
            diagnosticsUnsub = null
        }
        currentDiagnosticsClient = null
    }

    // Build the initial snapshot so non-subscribing consumers see correct
    // baseline data. The LSP subscriptions don't attach until `subscribe()`
    // is called.
    rebuildSnapshot()

    return {
        getSnapshot: () => snapshot,
        subscribe: (cb) => {
            const wasEmpty = listeners.size === 0
            listeners.add(cb)
            if (wasEmpty) attachAll()
            return () => {
                listeners.delete(cb)
                if (listeners.size === 0) detachAll()
            }
        },
        dispose: () => {
            detachAll()
            listeners.clear()
            cachedExtensions = null
            cachedExtensionsClient = null
        },
    }
}

// Re-export so callers don't need to know fileUriFromPath comes from lsp/.
export { fileUriFromPath }
