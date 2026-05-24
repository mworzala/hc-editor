import { useMemo, type ReactNode } from 'react'

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
} from '@hollowcube/design-system'

import { usePointAnchor } from '../../utils/virtual-anchor'

// Reusable context-menu component fed by an ad-hoc `ContextMenuAction[]`.
// Hosts build the action list at right-click time and pass it in — each
// action's `run` closure captures the target (file path, token, etc.).
//
// Unlike actions registered on `Project.actions`, these never participate
// in the global registry / hotkey bridge: they're scoped to one menu
// invocation. Keeping the type local is what lets us carry view-only
// concerns like `icon: ReactNode`.
//
// Items group by `action.group`; consecutive items with the same group sit
// next to each other, and transitions get a separator. `disabled === true`
// renders the item greyed-out (affordance — clicks are no-ops).

export type ContextMenuAction = {
    id: string
    title: string
    /** Optional grouping label; visually separates groups. */
    group?: string
    icon?: ReactNode
    keybinding?: string
    danger?: boolean
    disabled?: boolean
    run: () => void | Promise<void>
}

export type ActionContextMenuProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    x: number
    y: number
    actions: readonly ContextMenuAction[]
    className?: string
}

const SHORTCUT_FORMAT =
    navigator?.platform && /Mac|iPod|iPhone|iPad/u.test(navigator.platform) ? 'mac' : 'win'

export function ActionContextMenu({
    open,
    onOpenChange,
    x,
    y,
    actions,
    className,
}: ActionContextMenuProps) {
    const anchor = usePointAnchor(x, y)

    const items = useMemo<ReactNode[]>(() => {
        const out: ReactNode[] = []
        let prevGroup: string | undefined
        for (const action of actions) {
            if (prevGroup !== undefined && action.group !== prevGroup) {
                out.push(<DropdownMenuSeparator key={`sep-${action.id}`} />)
            }
            prevGroup = action.group
            out.push(
                <DropdownMenuItem
                    key={action.id}
                    disabled={action.disabled}
                    variant={action.danger ? 'destructive' : 'default'}
                    onClick={() => {
                        onOpenChange(false)
                        if (action.disabled) return
                        void action.run()
                    }}
                >
                    {action.icon ? <span className='inline-flex'>{action.icon}</span> : null}
                    <span>{action.title}</span>
                    {action.keybinding ? (
                        <DropdownMenuShortcut>
                            {formatKeybinding(action.keybinding)}
                        </DropdownMenuShortcut>
                    ) : null}
                </DropdownMenuItem>,
            )
        }
        return out
    }, [actions, onOpenChange])

    if (!open) return null
    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuContent
                anchor={anchor}
                side='bottom'
                align='start'
                className={className}
                // A context menu opens at a virtual point (no real trigger),
                // so base-ui's default "restore focus to whatever had it
                // before" steals focus away from anything an action's run()
                // might mount (e.g. the rename-file input the "New file…"
                // action shows). Opt out — actions that need focus grab it.
                finalFocus={false}
            >
                {items.length > 0 ? (
                    items
                ) : (
                    <div className='px-2 py-1.5 text-xs text-muted-foreground'>
                        No actions available
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function formatKeybinding(binding: string): string {
    return binding
        .split('+')
        .map((tok) => {
            const t = tok.trim().toLowerCase()
            if (t === '$mod') return SHORTCUT_FORMAT === 'mac' ? '⌘' : 'Ctrl'
            if (t === 'shift') return SHORTCUT_FORMAT === 'mac' ? '⇧' : 'Shift'
            if (t === 'alt') return SHORTCUT_FORMAT === 'mac' ? '⌥' : 'Alt'
            if (t === 'ctrl') return SHORTCUT_FORMAT === 'mac' ? '⌃' : 'Ctrl'
            if (t === 'meta') return SHORTCUT_FORMAT === 'mac' ? '⌘' : 'Meta'
            return tok.length === 1 ? tok.toUpperCase() : tok[0]!.toUpperCase() + tok.slice(1)
        })
        .join(SHORTCUT_FORMAT === 'mac' ? '' : '+')
}
