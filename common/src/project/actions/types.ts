// Action registry — the single source of truth for "things the user can do".
//
// Actions have a stable id (for analytics + keybinding lookup), a title (for
// the search popup / context menus / native menu), an optional group, optional
// icon (rendered in menus), an optional keybinding string, optional tagged
// `contexts` declaring where the action is available, and a handler.
//
// Producers register actions via `useRegisterAction(...)` or by passing them
// to `<ActionRegistryProvider initialActions={[...]}>`. Consumers (search
// popup, hotkey bridge, context menus, native menu) read them via
// `useActions()`.

import type { ReactNode } from 'react'

export const MENU_PATHS = ['file', 'edit', 'view', 'help'] as const
export type MenuPath = (typeof MENU_PATHS)[number]

/** Placement metadata for an action's appearance in the native menu bar. */
export type ActionMenu = {
    path: MenuPath
    /** Separator-bounded section within the submenu. Items with different
     *  `group` values are visually divided by a separator. */
    group?: string
    /** Sort order within a group; default 1000. */
    order?: number
    /** Display label override. Falls back to `Action.title` when absent. */
    label?: string
}

export type ActionRunSource = 'palette' | 'context-menu' | 'hotkey' | 'native-menu' | 'programmatic'

export type ActionRunContext = {
    /** How the action was invoked. Mostly for telemetry / disambiguation. */
    source: ActionRunSource
    /** Free-form args supplied at the invocation site (e.g. `{ path }` for a
     *  context-menu action targeting a specific file). */
    args?: Record<string, unknown>
}

export type Action = {
    id: string
    title: string
    /** Optional grouping for menu separators / search-popup headers.
     *  Default `'general'`. */
    group?: string
    icon?: ReactNode
    /** Keybinding string. Format follows @tanstack/react-hotkeys
     *  (e.g. `'$mod+p'`, `'shift+f5'`). */
    keybinding?: string
    /** Tag intersection: the action is available only when *every* tag here is
     *  in the active context set. Omit / empty for global. */
    contexts?: readonly string[]
    /** Dynamic guard. Rare — prefer `contexts`. When false, the action is
     *  hidden from listings and the hotkey is treated as inactive. */
    when?: () => boolean
    /** Render with the destructive variant in menus (red text). */
    danger?: boolean
    /** Visible but greyed in menus. The action still shows up in listings; the
     *  click is a no-op. Useful for affordance (e.g. "Find Usages" without a
     *  token under the cursor). */
    disabled?: boolean
    /** When present, the action appears in the native menu bar under
     *  `menu.path`. Absent = palette / hotkey only. */
    menu?: ActionMenu
    run: (ctx: ActionRunContext) => void | Promise<void>
}

/** Set of currently active context tags. Computed by ActionContextProvider. */
export type ActionContextSet = ReadonlySet<string>
