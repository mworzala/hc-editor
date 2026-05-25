// `ActiveEditorRegistry` — the model-layer home for "which text editor is
// currently mounted, where, with what view-level handlers."
//
// Two surfaces:
//
//   • The `Map<tabId, entry>` (CodeMirror view + save handler + LSP URI +
//     language) — looked up by `editor.save` / `editor.format` /
//     `editor.codeAction` etc.
//   • An `activeDocId: ReadonlySignal<string | null>` — the focused tab
//     id. `<EditorFocusBridge>` pushes the focused leaf's `activeId` here
//     whenever layout focus changes; action handlers read it via `.peek()`
//     to resolve the focused entry.

import type { EditorView } from '@codemirror/view'

import type { LanguageDefinition } from '../../editor/languages/types'
import { signal, type ReadonlySignal } from '../foundation/signal'

export type ActiveEditorEntry = {
    view: EditorView
    language?: LanguageDefinition
    /** LSP URI for this tab when an LSP binding is active. */
    lspUri?: string
}

export class ActiveEditorRegistry {
    private readonly _registry = new Map<string, ActiveEditorEntry>()
    private readonly _activeDocId = signal<string | null>(null)

    /** The currently focused tab id, if known. `<EditorFocusBridge>` pushes
     *  this on layout focus changes; tests and other callers can use
     *  `setActiveDocId` imperatively. */
    readonly activeDocId: ReadonlySignal<string | null> = this._activeDocId

    register(tabId: string, entry: ActiveEditorEntry): void {
        this._registry.set(tabId, entry)
    }

    unregister(tabId: string): void {
        this._registry.delete(tabId)
    }

    get(tabId: string): ActiveEditorEntry | undefined {
        return this._registry.get(tabId)
    }

    setActiveDocId(tabId: string | null): void {
        this._activeDocId.value = tabId
    }

    dispose(): void {
        this._registry.clear()
        this._activeDocId.value = null
    }
}
