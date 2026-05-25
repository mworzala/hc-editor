// `DialogService` — modal-dialog state for prompts the model layer needs
// to surface (save-as path, future confirms / picks). One active dialog at
// a time; opening a new one rejects (cancels) the previous.
//
// The service knows nothing about React — it exposes a signal for the
// active state plus `confirm` / `cancel` closures on each state entry.
// A React overlay component subscribes via `useSignal(dialogs.active)` and
// renders the appropriate UI, invoking the closures on submit / cancel.
//
// Each `open*` method returns a Promise that resolves with the user's
// answer (or `null` on cancel). Callers can `await` it from action
// handlers without dragging React into the call site.

import { signal, type ReadonlySignal } from '../foundation/signal'

export type SavePathDialogState = {
    kind: 'savePath'
    suggested: string
    confirm: (path: string) => void
    cancel: () => void
}

export type DialogState = SavePathDialogState

export class DialogService {
    private readonly _active = signal<DialogState | null>(null)

    /** The currently open dialog, or `null` when none. The React overlay
     *  subscribes to this. */
    readonly active: ReadonlySignal<DialogState | null> = this._active

    /** Open the save-as path prompt. Resolves with the chosen path or
     *  `null` if the user cancels. Opening another dialog first cancels
     *  this one (resolves with `null`). */
    savePath(opts: { suggested: string }): Promise<string | null> {
        return new Promise<string | null>((resolve) => {
            this._replaceActive((cleanup) => ({
                kind: 'savePath',
                suggested: opts.suggested,
                confirm: (path: string) => {
                    cleanup()
                    resolve(path)
                },
                cancel: () => {
                    cleanup()
                    resolve(null)
                },
            }))
        })
    }

    /** Force-close any active dialog by invoking its cancel handler.
     *  Use sparingly — prefer letting the user dismiss. */
    closeActive(): void {
        const cur = this._active.peek()
        if (cur) cur.cancel()
    }

    dispose(): void {
        const cur = this._active.peek()
        if (cur) cur.cancel()
        this._active.value = null
    }

    /** Replace the active dialog with a new one. If a previous dialog
     *  is open, its cancel handler is invoked first so its promise
     *  resolves with `null`. The `cleanup` arg passed to the factory
     *  clears the active signal when the new dialog resolves. */
    private _replaceActive(factory: (cleanup: () => void) => DialogState): void {
        const prev = this._active.peek()
        // Clear before invoking prev.cancel so prev's cleanup doesn't see
        // its own state when computing this._active.peek().
        this._active.value = null
        if (prev) prev.cancel()
        let installed: DialogState | null = null
        const cleanup = () => {
            if (this._active.peek() === installed) {
                this._active.value = null
            }
        }
        installed = factory(cleanup)
        this._active.value = installed
    }
}
