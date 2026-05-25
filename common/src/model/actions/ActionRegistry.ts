// `ActionRegistry` — the signals-era command bus.
//
// Owns the set of registered actions and exposes the universal `run(id)`
// entry point. Two design points worth calling out:
//
//   • The registration set is stored in a signal so consumers
//     (`enabledActions`, hotkey bridges, command palette) participate in
//     the signals graph.
//   • `Action.when` is a string expression; evaluation goes through
//     `ContextService` so the `enabledActions` computed re-runs only when
//     the specific keys it depends on change.
//
// The `enabledActions` derived signal is the authoritative listing
// surface — no manual subscribe/version-counter dance for consumers.

import type { ContextService } from '../context/ContextService'
import { computed, signal, type ReadonlySignal } from '../foundation/signal'
import type { Action, ActionRunArgs, AnyAction } from './types'

export interface ActionRegistryDeps {
    context: ContextService
}

export class ActionRegistry {
    private readonly _actions = signal<ReadonlyMap<string, AnyAction>>(new Map())

    readonly enabledActions: ReadonlySignal<readonly AnyAction[]>

    constructor(private readonly deps: ActionRegistryDeps) {
        // `computed` is lazy; reading `.value` registers dependencies on
        // both the action map and any context keys referenced by `when`.
        this.enabledActions = computed(() => {
            const out: AnyAction[] = []
            for (const action of this._actions.value.values()) {
                if (!this.deps.context.evaluate(action.when)) continue
                out.push(action)
            }
            return out
        })
    }

    /** Register an action. Returns a disposer; calling it removes the
     *  action, but only if the entry under that id is still this exact
     *  registration (defends against racy re-registers).
     *
     *  Generic over the action's payload type: `register<MyArgs>({...})`
     *  gives the handler a typed `args` parameter. Defaults to `void`
     *  for parameterless actions. */
    register<TArgs = void>(action: Action<TArgs>): () => void {
        const erased = action as AnyAction
        this._writeMap((next) => next.set(action.id, erased))
        return () => {
            if (this._actions.peek().get(action.id) === erased) {
                this._writeMap((next) => next.delete(action.id))
            }
        }
    }

    /** Force-remove the action under `id`, regardless of registration
     *  identity. Prefer the disposer returned by `register` when possible. */
    unregister(id: string): void {
        if (!this._actions.peek().has(id)) return
        this._writeMap((next) => next.delete(id))
    }

    get(id: string): AnyAction | undefined {
        return this._actions.peek().get(id)
    }

    list(): readonly AnyAction[] {
        return [...this._actions.peek().values()]
    }

    /** Run the action under `id`, evaluating its when-clause first.
     *  Returns `true` if the handler was invoked; `false` if the action
     *  was missing, gated by its when-clause, or `disabled`.
     *
     *  `args` is `unknown` because the id → payload-type relationship is
     *  dynamic at the run boundary — the handler narrows the type. Use
     *  `register<TArgs>` to type-check the handler at registration time.
     *
     *  Errors thrown synchronously from `run` are caught and logged so a
     *  single bad action can't take down the caller; async errors are
     *  surfaced via the returned promise (whose rejection the caller is
     *  free to ignore — matching the prior class's contract). */
    run(id: string, args?: ActionRunArgs): boolean {
        const action = this._actions.peek().get(id)
        if (!action) return false
        if (!this.deps.context.evaluate(action.when)) return false
        if (action.disabled) return false
        try {
            void action.run(args)
        } catch (err) {
            console.error(`[action:${id}] threw synchronously`, err)
        }
        return true
    }

    /** Lookup an action's keybinding by id. */
    keybindingFor(id: string): string | undefined {
        return this._actions.peek().get(id)?.keybinding
    }

    /** Find the action whose keybinding matches the given binding string.
     *  Linear scan; the keybinding set is small in practice. */
    actionForKeybinding(binding: string): AnyAction | undefined {
        for (const action of this._actions.peek().values()) {
            if (action.keybinding === binding) return action
        }
        return undefined
    }

    dispose(): void {
        this._actions.value = new Map()
    }

    private _writeMap(mutate: (next: Map<string, AnyAction>) => void): void {
        const next = new Map(this._actions.peek())
        mutate(next)
        this._actions.value = next
    }
}
