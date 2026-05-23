// Action shape for the new (signals-era) action registry.
//
// Intentionally duplicates the existing `common/src/project/actions/types.ts`
// for the duration of the migration. The differences are:
//
//   • `when` is now a string expression evaluated against `ContextService`
//     (the architecture's universal context-key surface), not a `() =>
//     boolean` closure. This is what lets `enabledActions` participate in
//     the reactive graph.
//   • `contexts: readonly string[]` is dropped — fold whatever tag check
//     was there into the `when` expression.
//
// The old type stays until Phase 6 has moved every consumer onto the new
// surface; Phase 7 deletes the old types file outright.

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

export type ActionRunArgs = Record<string, unknown>

export type Action = {
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
    run(args?: ActionRunArgs): void | Promise<void>
}
