import { type EditorView } from '@codemirror/view'

import { type LanguageDefinition } from './languages/types'

// Module-level registry of currently mounted text editors, keyed by the
// workspace `tab.id`. The text-tab wrapper populates this when its CodeEditor
// view mounts; globally-registered actions (e.g. `editor.format`) consume it
// to find the right view to act on without having to thread refs through the
// React tree.
//
// Module-level mutable state is acceptable here because there is only ever one
// workspace per process and CodeEditor instances always belong to it. The
// store cleans up entries on unmount so stale views aren't held.

export type ActiveEditorEntry = {
    view: EditorView
    language?: LanguageDefinition
    /** Optional save handler. Globally-bound actions (`editor.save`) call this
     *  to dispatch a save to the currently focused tab. Returns true on
     *  successful save, false (or throws) if the save was cancelled or
     *  errored. */
    save?: () => Promise<boolean>
    /** LSP URI for this tab when an LSP binding is active. Lets globally-bound
     *  LSP actions (`editor.codeAction`, `editor.rename`, …) route the right
     *  request without re-deriving the URI from the workspace store. */
    lspUri?: string
}

const registry = new Map<string, ActiveEditorEntry>()

export function setActiveEditor(tabId: string, entry: ActiveEditorEntry): void {
    registry.set(tabId, entry)
}

export function clearActiveEditor(tabId: string): void {
    registry.delete(tabId)
}

export function getActiveEditor(tabId: string): ActiveEditorEntry | undefined {
    return registry.get(tabId)
}
