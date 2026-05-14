import type { CodeAction, Command } from 'vscode-languageserver-types'

// Coordinates LSP-driven floating UI (code-action menu, rename popover) that
// lives outside the CodeMirror view. The action registry's run handlers open
// these from anywhere; the overlay component subscribes and renders.

export type CodeActionMenuState = {
    /** Viewport coordinates anchoring the popover. */
    x: number
    y: number
    /** Items returned by `textDocument/codeAction` (CodeAction | Command). */
    items: (CodeAction | Command)[]
    /** Triggers the apply-edit / executeCommand pipeline for a chosen item. */
    onSelect: (item: CodeAction | Command) => void
}

export type RenamePromptState = {
    /** Viewport coordinates anchoring the popover. */
    x: number
    y: number
    /** Current symbol text used to prefill the input. */
    initialName: string
    /** Submits the new name; the caller drives the LSP rename + apply edit. */
    onConfirm: (newName: string) => void
}

type Snapshot = {
    codeAction: CodeActionMenuState | null
    rename: RenamePromptState | null
}

export class LspUiBus {
    private snapshot: Snapshot = { codeAction: null, rename: null }
    private listeners = new Set<() => void>()

    getSnapshot(): Snapshot {
        return this.snapshot
    }

    subscribe(cb: () => void): () => void {
        this.listeners.add(cb)
        return () => {
            this.listeners.delete(cb)
        }
    }

    openCodeActionMenu(state: CodeActionMenuState): void {
        this.snapshot = { ...this.snapshot, codeAction: state }
        this.emit()
    }

    closeCodeActionMenu(): void {
        if (!this.snapshot.codeAction) return
        this.snapshot = { ...this.snapshot, codeAction: null }
        this.emit()
    }

    openRenamePrompt(state: RenamePromptState): void {
        this.snapshot = { ...this.snapshot, rename: state }
        this.emit()
    }

    closeRenamePrompt(): void {
        if (!this.snapshot.rename) return
        this.snapshot = { ...this.snapshot, rename: null }
        this.emit()
    }

    private emit(): void {
        for (const cb of this.listeners) cb()
    }
}
