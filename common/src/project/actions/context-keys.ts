// ContextKeys — plain-TypeScript reactive boolean map.
//
// VS Code calls this a "context key" service. It's a simple key→boolean store
// that any producer (workspace, document store, LSP client) writes into, and
// any consumer (action filter, menu visibility) reads from. Subscribers fire
// only on real changes (idempotent writes are a no-op).
//
// The action registry uses it to scope `Action.contexts` — an action with
// `contexts: ['editor:text', 'editor:dirty']` is available iff both keys are
// `true`. Keys not yet set read as `false`.
//
// Typed via a template-literal union so `'editor:text'` and `'tool:files'`
// are typo-checked. Unknown strings widen to `string` rather than failing —
// keys can be invented at runtime, but the common static surfaces are kept
// honest by autocompletion.

export type ToolKey = `tool:${string}`
export type EditorKey = `editor:${string}`
export type LspKey = `lsp.${string}.running` | `lsp.${string}.starting` | `lsp.${string}.failed`

/** Built-in keys. Extend the union as new producers come online. */
export type ContextKey =
    | 'global'
    | ToolKey
    | EditorKey
    | 'editor:dirty'
    | 'editor:has-selection'
    | LspKey
    | (string & {}) // allow ad-hoc keys without losing autocomplete on the literals

export class ContextKeys {
    private state = new Map<ContextKey, boolean>()
    private listeners = new Set<() => void>()

    constructor() {
        // 'global' is always on.
        this.state.set('global', true)
    }

    /** Set a key to a boolean value. No-op if the value didn't change. */
    set(key: ContextKey, value: boolean): void {
        const prev = this.state.get(key) ?? false
        if (prev === value) return
        if (value) {
            this.state.set(key, true)
        } else {
            this.state.delete(key)
        }
        for (const cb of this.listeners) cb()
    }

    /** True iff the key has been explicitly set to true. */
    get(key: ContextKey): boolean {
        return this.state.get(key) === true
    }

    /** Snapshot of every truthy key. Stable identity is not guaranteed —
     *  callers using `useSyncExternalStore` should cache by a separate
     *  version counter, or compare structurally. */
    all(): readonly ContextKey[] {
        return Array.from(this.state.keys())
    }

    /** Subscribe to changes. Returns the unsubscribe handle. */
    subscribe(cb: () => void): () => void {
        this.listeners.add(cb)
        return () => {
            this.listeners.delete(cb)
        }
    }

    /** Bulk replace: set the keys listed in `nextOn` to true and clear every
     *  key not in the set (except `'global'`, which stays on). Used by
     *  producers that emit a fresh full-state snapshot (workspace store,
     *  initial mount). */
    replaceAll(nextOn: Iterable<ContextKey>): void {
        const next = new Set<ContextKey>(['global'])
        for (const k of nextOn) next.add(k)
        let changed = false
        for (const k of Array.from(this.state.keys())) {
            if (!next.has(k)) {
                this.state.delete(k)
                changed = true
            }
        }
        for (const k of next) {
            if (!this.state.has(k)) {
                this.state.set(k, true)
                changed = true
            }
        }
        if (changed) {
            for (const cb of this.listeners) cb()
        }
    }
}

/** True iff every `required` key is currently set. Empty `required` always
 *  matches. Mirrors the existing `actionMatchesContext` semantics. */
export function contextMatches(
    keys: ContextKeys,
    required: readonly ContextKey[] | undefined,
): boolean {
    if (!required || required.length === 0) return true
    for (const k of required) {
        if (!keys.get(k)) return false
    }
    return true
}
