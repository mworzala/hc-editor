import { type Extension } from '@codemirror/state'
import { type EditorView } from '@codemirror/view'

import { type EngineApiDoc } from '../../engine-api'
import { type LspService } from '../../model/lsp/LspService'
import { type OpenEditorArgs } from '../../project/actions/project-actions'
import { type UsageMatch } from '../components/UsagesPopup'

// Lightweight registration for a language. Carries:
//  • Always-on extensions / formatter (cmExtension, formatter).
//  • An optional per-tab `createEditorServices(deps)` factory that returns a
//    subscribable binding (LSP extensions, diagnostic counts, goto-def, ...).
//    The text editor mounts the binding and renders any UI from its snapshot.
//    Languages without rich services (JSON today, simple highlights, etc.)
//    just omit this field.

export type FormatResult = { ok: true; text: string } | { ok: false; error: string }

export type DiagnosticCounts = {
    errors: number
    warnings: number
    infos: number
    hints: number
    total: number
}

/** Per-tab, language-scoped editor services. Plain data — no JSX. The text
 *  editor reads this snapshot and renders any UI itself (e.g. the diagnostic
 *  badge). All fields are optional so partial implementations are fine. */
export type EditorServices = {
    /** Additional CodeMirror extensions to merge with the language's
     *  always-on `cmExtension()`. Typically LSP overlays / semantic tokens. */
    extensions?: Extension[]
    /** Imperative goto-definition. If present, the text editor's right-click
     *  "Go to definition" item dispatches here. */
    gotoDefinitionAt?: (pos: number, view: EditorView) => void | Promise<void>
    /** Current diagnostic counts for this tab. The text editor renders a
     *  badge from this when total > 0. */
    diagnosticCounts?: DiagnosticCounts
    /** When true, the editor should defer cmd-click "find usages" to the
     *  language (which usually wires this through LSP references). */
    suppressCmdClickUsages?: boolean
    /** When true, the editor should hide the built-in fold gutter — the
     *  language is providing semantic folding through `extensions` instead. */
    suppressFoldGutter?: boolean
}

/** Subscribable handle a language exposes for a single editor tab. Lifecycle:
 *
 *   • Constructed once per (language, uri) combination in the text editor's
 *     render body via `language.createEditorServices(deps)`.
 *   • `getSnapshot()` returns the current `EditorServices`. Must return a
 *     stable reference when the underlying data hasn't changed (so
 *     `useSyncExternalStore` doesn't thrash).
 *   • `subscribe(cb)` registers a change listener. The binding owns its
 *     internal subscriptions (LSP state, diagnostics, ...) and fires `cb`
 *     when the snapshot changes.
 *   • `dispose()` runs on tab close — release all internal subscriptions. */
export type LanguageEditorBinding = {
    getSnapshot: () => EditorServices
    subscribe: (cb: () => void) => () => void
    dispose: () => void
}

/** Dependencies handed to a language at editor-tab-binding time. Generic over
 *  every language: no LSP-specific types leak in. Luau's binding builds its
 *  LSP plumbing on top of these. */
export type LanguageEditorDeps = {
    /** Model-layer LSP service. Languages that drive LSP (Luau) read the
     *  client + diagnostics from here; non-LSP languages can ignore it. */
    lsp: LspService
    /** Absolute path (project-relative) of the file being edited. */
    path: string
    /** LSP-style file URI matching `path`. Languages that drive LSP use this
     *  as the canonical document identity; non-LSP languages can ignore it. */
    uri: string
    /** Known project file paths. Some languages (Luau) resolve cross-file
     *  navigation against this list. A getter (not a value) so the binding
     *  reads the latest set lazily — the tree changes on every save (the
     *  file's metadata is upserted) and rebuilding the binding on each save
     *  remounts the underlying CodeMirror view, blowing away cursor/scroll. */
    getKnownPaths: () => readonly string[]
    /** Generic "open another editor tab" dispatcher. The Luau binding uses
     *  this for cross-file goto-definition; other languages may use it for
     *  jump-to-symbol UI. */
    openEditor: (args: OpenEditorArgs) => void
    /** Surface a usages popup near the editor. The Luau binding wires
     *  click-on-declaration → "show references" through this. The text
     *  editor derives the popup's title from the document itself, so this
     *  signature is intentionally narrow. */
    showUsages: (
        matches: UsageMatch[],
        anchorPos: number,
        sourceRange: { from: number; to: number },
    ) => void
    /** The loaded engine API doc, or `null` until the bundle resolves. A
     *  getter (not a value) so the binding reads the latest without being
     *  rebuilt when the bundle loads. The Luau binding uses it to render its
     *  own hover docs for engine symbols. */
    getEngineApiDoc: () => EngineApiDoc | null
}

export type LanguageDefinition = {
    /** Stable identifier (e.g. 'json', 'luau'). Used to look up by id. */
    id: string
    /** Mime patterns accepted (supports `<type>/*` wildcards). */
    mimeTypes: readonly string[]
    /** Lower-cased file extensions including the dot, e.g. ['.json'] or ['.luau', '.lua']. */
    extensions: readonly string[]
    /** Factory for the CodeMirror language/highlighting extension. Called once
     *  per editor mount. */
    cmExtension: () => Extension
    /** Optional formatter. Returns the formatted text or an error message.
     *  May be async — WASM-backed formatters need lazy initialisation. */
    formatter?: (text: string) => FormatResult | Promise<FormatResult>
    /** Optional factory for per-tab editor services (LSP extensions, semantic
     *  tokens, diagnostics, ...). Called once per text-editor tab mount; the
     *  returned binding is `dispose()`d on unmount. */
    createEditorServices?: (deps: LanguageEditorDeps) => LanguageEditorBinding
}
