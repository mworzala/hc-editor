// `Emitter<T>` — a small typed event emitter for discrete events that are
// not state (e.g. "a save just succeeded", "a conflict appeared"). State
// belongs in signals; this is for one-shot notifications.
//
// Services hold the `Emitter` privately and expose only the `event`
// subscribe function so outside code can listen but cannot fire.

export type Event<T> = (listener: (value: T) => void) => () => void

export class Emitter<T> {
    private listeners = new Set<(value: T) => void>()

    event: Event<T> = (listener) => {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    fire(value: T): void {
        // Snapshot before iterating: listeners may unsubscribe (or add) during
        // delivery, and we don't want a concurrent-modification surprise.
        const snapshot = [...this.listeners]
        for (const l of snapshot) {
            try {
                l(value)
            } catch (err) {
                // One bad listener must not abort the rest. Mirrors the
                // permissive contract of DOM-style event targets.
                console.error('[Emitter] listener threw', err)
            }
        }
    }

    dispose(): void {
        this.listeners.clear()
    }
}
