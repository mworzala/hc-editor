// `ContextService` — the reactive context-key store that action when-clauses
// evaluate against. VS Code calls this a "context key service"; here it's
// reified as a small service so when-clauses participate in the signals
// reactivity graph: an `ActionRegistry.enabledActions` computed will only
// re-run when the specific context keys its actions depend on change.
//
// Two production patterns:
//
//   • `derive(key, fn)` — most context keys are pure functions of other
//     signals (`editorDirty` is "is the active doc's `dirty` signal true?").
//     An `effect` writes the function's value into the key's stable
//     backing signal whenever any upstream signal it reads changes.
//
//   • `set(key, value)` — a few keys are pushed in from outside the model
//     layer (notably `editorFocused` from React's focus events). The
//     setter writes directly to the backing signal.
//
// The "backing signal per key" indirection gives every key a stable
// identity for subscribers: a consumer that read `evaluate('editorDirty')`
// before `derive('editorDirty', ...)` was called still gets notified when
// the derived value first becomes available, because subscription is to
// the backing signal — not to the closure that feeds it.

import { effect, signal, type Signal } from '../foundation/signal'
import {
    evaluateWhenClause,
    parseWhenClause,
    type WhenAst,
    type WhenLookup,
} from '../foundation/when-clause'

export class ContextService {
    private readonly _backing = new Map<string, Signal<unknown>>()
    private readonly _derivedDisposers = new Map<string, () => void>()
    private readonly _astCache = new Map<string, WhenAst>()

    /** Register a derived context key. An `effect` is installed that
     *  writes `fn()`'s value into the key's stable backing signal each
     *  time any upstream signal `fn` reads changes. Calling `derive`
     *  again with the same key replaces the prior derivation. */
    derive(key: string, fn: () => unknown): () => void {
        this._disposeDerived(key)
        const backing = this._ensure(key)
        const stop = effect(() => {
            backing.value = fn()
        })
        this._derivedDisposers.set(key, stop)
        return () => {
            // Only honor this disposer if it's still the live one for the
            // key — defends against re-derive followed by an old caller
            // calling the stale dispose.
            if (this._derivedDisposers.get(key) === stop) {
                this._derivedDisposers.delete(key)
                stop()
            }
        }
    }

    /** Set a key imperatively. If the key was previously installed as a
     *  derivation, the derivation is replaced (its effect is stopped)
     *  and the explicit value takes over. */
    set(key: string, value: unknown): void {
        this._disposeDerived(key)
        this._ensure(key).value = value
    }

    /** Read the current value without subscribing. Returns `undefined`
     *  for unknown keys (and for keys that have been subscribed-to but
     *  never assigned). Use inside imperative code only — reactive
     *  consumers go through `evaluate(...)`. */
    get(key: string): unknown {
        return this._backing.get(key)?.peek()
    }

    /** Evaluate a when-clause against the current context. The lookup
     *  reads `.value` on each referenced key, so any wrapping `computed`
     *  (e.g. `ActionRegistry.enabledActions`) tracks the right
     *  dependencies. Empty input evaluates to `true` — the convention
     *  for "no guard". */
    evaluate(whenClause: string | undefined): boolean {
        if (!whenClause) return true
        let ast = this._astCache.get(whenClause)
        if (!ast) {
            ast = parseWhenClause(whenClause)
            this._astCache.set(whenClause, ast)
        }
        return evaluateWhenClause(ast, this._lookup)
    }

    private readonly _lookup: WhenLookup = (key) => {
        // Lazy-create the backing signal so a consumer subscribing before
        // the key is set still latches onto the stable signal that
        // future `set` / `derive` calls will write through.
        const s = this._ensure(key)
        // Intentional `.value`: this lookup is invoked from inside
        // callers' `computed(() => ctx.evaluate(...))` blocks (notably
        // `ActionRegistry.enabledActions`), so the read must register a
        // reactive dependency on the backing signal. The lint:signals
        // script can't see the runtime context lexically — escape hatch.
        // lint:signals-ignore
        return s.value
    }

    dispose(): void {
        // Snapshot to a local array first: the disposers each call back
        // into the map to remove themselves, and mutating it under a
        // direct iterator is asking for trouble.
        const disposers = [...this._derivedDisposers.values()]
        for (const d of disposers) d()
        this._derivedDisposers.clear()
        this._backing.clear()
        this._astCache.clear()
    }

    private _ensure(key: string): Signal<unknown> {
        let s = this._backing.get(key)
        if (!s) {
            s = signal<unknown>(undefined)
            this._backing.set(key, s)
        }
        return s
    }

    private _disposeDerived(key: string): void {
        const stop = this._derivedDisposers.get(key)
        if (stop) {
            this._derivedDisposers.delete(key)
            stop()
        }
    }
}
