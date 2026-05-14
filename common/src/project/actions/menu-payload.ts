// Builds the wire-format payload for the native menu bar from the current
// action registry + context-tag set. Pure, synchronous, deterministic — the
// React bridge wraps a JSON-equality check around the output so it only emits
// to the host when the rendered menu would actually change.

import type { MenuItemPayload } from '../../platform/types'
import { actionMatchesContext } from './context'
import { MENU_PATHS, type Action, type ActionContextSet, type MenuPath } from './types'

const DEFAULT_ORDER = 1000

const warnedPaths = new Set<string>()

type BuildArgs = {
    actions: readonly Action[]
    contextSet: ActionContextSet
}

export function buildMenuPayload({ actions, contextSet }: BuildArgs): readonly MenuItemPayload[] {
    const out: MenuItemPayload[] = []
    for (const action of actions) {
        const menu = action.menu
        if (!menu) continue
        if (!isMenuPath(menu.path)) {
            if (import.meta.env.DEV && !warnedPaths.has(menu.path)) {
                warnedPaths.add(menu.path)
                console.warn(
                    `[menu-payload] action ${action.id} has unknown menu.path "${menu.path}"; expected one of ${MENU_PATHS.join(', ')}`,
                )
            }
            continue
        }
        const enabled =
            actionMatchesContext(contextSet, action.contexts) &&
            !action.disabled &&
            (action.when?.() ?? true)
        out.push({
            path: menu.path,
            actionId: action.id,
            label: menu.label ?? action.title,
            group: menu.group ?? '',
            order: menu.order ?? DEFAULT_ORDER,
            accelerator: translateKeybinding(action.keybinding),
            enabled,
        })
    }
    out.sort(compareItems)
    return out
}

function compareItems(a: MenuItemPayload, b: MenuItemPayload): number {
    if (a.path !== b.path) return a.path.localeCompare(b.path)
    if (a.group !== b.group) return a.group.localeCompare(b.group)
    if (a.order !== b.order) return a.order - b.order
    return a.label.localeCompare(b.label)
}

function isMenuPath(value: string): value is MenuPath {
    return (MENU_PATHS as readonly string[]).includes(value)
}

const MODIFIER_LABELS: Record<string, string> = {
    $mod: 'CmdOrCtrl',
    mod: 'CmdOrCtrl',
    cmd: 'CmdOrCtrl',
    ctrl: 'Ctrl',
    control: 'Ctrl',
    shift: 'Shift',
    alt: 'Alt',
    option: 'Alt',
    meta: 'CmdOrCtrl',
}

/** Translate a `@tanstack/react-hotkeys` keybinding (e.g. `'$mod+shift+f'`)
 *  into the Wails accelerator format (e.g. `'CmdOrCtrl+Shift+F'`). Empty
 *  input → empty output. */
export function translateKeybinding(keybinding: string | undefined): string {
    if (!keybinding) return ''
    const parts = keybinding
        .split('+')
        .map((p) => p.trim())
        .filter(Boolean)
    if (parts.length === 0) return ''
    const out: string[] = []
    for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1
        const token = parts[i]!
        if (isLast) {
            out.push(formatKeyToken(token))
        } else {
            out.push(MODIFIER_LABELS[token.toLowerCase()] ?? capitalize(token))
        }
    }
    return out.join('+')
}

function formatKeyToken(token: string): string {
    const lower = token.toLowerCase()
    // Single-letter keys → uppercase, matches typical accelerator convention.
    if (lower.length === 1) return lower.toUpperCase()
    // Function keys: `f1` → `F1`.
    if (/^f\d{1,2}$/u.test(lower)) return lower.toUpperCase()
    // Named keys pass through as-is in lowercase (backspace, tab, return,
    // enter, escape, space, delete, home, end, pageup, pagedown, arrow keys).
    return lower
}

function capitalize(s: string): string {
    if (s.length === 0) return s
    return s[0]!.toUpperCase() + s.slice(1).toLowerCase()
}
