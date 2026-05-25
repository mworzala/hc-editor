// `LspUiBus` — floating UI for LSP-driven popovers (the code-action menu
// and the rename prompt) lives outside the CodeMirror view. Owned by
// `LspService` (`Project.lsp.ui`) so action handlers can open these from
// anywhere; the React overlay subscribes via signals.
//
// Each kind has its own signal so subscribers only react to the slot
// they actually render — opening the code-action menu doesn't re-render
// the rename popover.
//
// The state entries carry their own confirm / cancel closures, so callers
// pass a Promise-style API in one shot rather than wiring a separate
// "open / wait / read result" handshake.

import type { CodeAction, Command } from 'vscode-languageserver-types'

import { signal, type ReadonlySignal } from '../foundation/signal'

export type CodeActionMenuState = {
    /** Viewport coordinates anchoring the popover. */
    x: number
    y: number
    /** Items returned by `textDocument/codeAction`. */
    items: (CodeAction | Command)[]
    /** Triggers the apply-edit / executeCommand pipeline for a chosen item. */
    onSelect: (item: CodeAction | Command) => void
}

export type RenamePromptState = {
    x: number
    y: number
    initialName: string
    onConfirm: (newName: string) => void
}

export class LspUiBus {
    private readonly _codeAction = signal<CodeActionMenuState | null>(null)
    private readonly _rename = signal<RenamePromptState | null>(null)

    readonly codeAction: ReadonlySignal<CodeActionMenuState | null> = this._codeAction
    readonly rename: ReadonlySignal<RenamePromptState | null> = this._rename

    openCodeActionMenu(state: CodeActionMenuState): void {
        this._codeAction.value = state
    }

    closeCodeActionMenu(): void {
        if (this._codeAction.peek() === null) return
        this._codeAction.value = null
    }

    openRenamePrompt(state: RenamePromptState): void {
        this._rename.value = state
    }

    closeRenamePrompt(): void {
        if (this._rename.peek() === null) return
        this._rename.value = null
    }

    dispose(): void {
        this._codeAction.value = null
        this._rename.value = null
    }
}
