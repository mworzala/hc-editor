// Action shape for the signals-era action registry.
//
// Two design choices vs. the old (deleted) action surface:
//
//   • `when` is a string expression evaluated against `ContextService`
//     (the universal context-key surface), not a `() => boolean` closure.
//     This is what lets `enabledActions` participate in the reactive
//     graph — the computed re-evaluates only when keys referenced by some
//     action's when-clause change.
//   • There is no `contexts: readonly string[]`. Whatever availability
//     check was there folds into the `when` expression.
//
// `Action<TArgs>` is generic over the payload type. Registration sites
// supply the concrete args type so the handler is typed without casts.
// The registry's `run(id, args)` stays loose (`unknown` args) because
// the id → args mapping is dynamic — the handler narrows at the boundary.

export const MENU_PATHS = ['file', 'edit', 'view', 'help'] as const
export type MenuPath = (typeof MENU_PATHS)[number]

export type ActionMenu = {
    path: MenuPath
    /** Separator-bounded section. */
    group: string
    /** Sort order within the group. */
    order: number
    /** Display override; falls back to `Action.title`. */
    label?: string
}

export type ActionRunSource = 'palette' | 'context-menu' | 'hotkey' | 'native-menu' | 'programmatic'

/** Loose carrier for action payloads at the `run(id, args)` boundary. */
export type ActionRunArgs = unknown

export type Action<TArgs = void> = {
    /** Unique, dotted id: `'editor.save'`, `'files.create'`. */
    id: string
    /** Human-readable. Shown in menus and the command palette. */
    title: string
    /** Optional grouping label for command-palette / menu sections. */
    group?: string
    /** Keybinding string. Format matches @tanstack/react-hotkeys
     *  (`'$mod+s'`, `'shift+f5'`). */
    keybinding?: string
    /** When-clause string evaluated against `ContextService`. Omit for
     *  always-enabled. */
    when?: string
    /** Render with destructive variant in menus. */
    danger?: boolean
    /** Visible but greyed; the click is a no-op. */
    disabled?: boolean
    /** Optional placement in the native menu bar. */
    menu?: ActionMenu
    /** Handler. `TArgs = void` for parameterless actions (the default);
     *  otherwise the payload type the registration accepts. */
    run(args: TArgs): void | Promise<void>
}

/** Heterogeneous storage shape. The registry's internal map holds these. */
export type AnyAction = Action<any>
