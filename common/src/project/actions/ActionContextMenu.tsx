import { useMemo, type ReactNode } from 'react'

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
} from '@hollowcube/design-system'

import { usePointAnchor } from '../../utils/virtual-anchor'
import { actionMatchesContext, useActionContextSet } from './context'
import { type Action, type ActionRunContext } from './types'

// Reusable context-menu component fed by an `Action[]`. Replaces the ad-hoc
// DropdownMenu boilerplate that used to live in `tools/files.tsx` and
// `editor/components/EditorContextMenu.tsx`.
//
// Convention: the host builds the action list at right-click time, so each
// action's `run` closure captures the target (file path, token, etc.). The
// menu just renders the list and dispatches.
//
// Items are split into groups by `action.group`; consecutive items with the
// same group sit next to each other, transitions get a separator. Items where
// `actionMatchesContext` returns false are omitted entirely (treat as "not
// applicable"). Items where `disabled === true` are shown greyed-out — that's
// for affordance ("Find Usages" without a token on the cursor).

export type ActionContextMenuProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    x: number
    y: number
    actions: readonly Action[]
    /** Optional args bag applied to every action.run in this menu. Convenient
     *  when many actions in the same menu share a target. */
    runArgs?: Record<string, unknown>
    className?: string
}

const SHORTCUT_FORMAT =
    navigator?.platform && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'mac' : 'win'

export function ActionContextMenu({
    open,
    onOpenChange,
    x,
    y,
    actions,
    runArgs,
    className,
}: ActionContextMenuProps) {
    const anchor = usePointAnchor(x, y)
    const activeCtx = useActionContextSet()

    const visible = useMemo(
        () => actions.filter((a) => actionMatchesContext(activeCtx, a.contexts)),
        [actions, activeCtx],
    )

    const close = () => onOpenChange(false)

    const items: ReactNode[] = []
    let prevGroup: string | undefined
    for (const action of visible) {
        if (action.when && !action.when()) continue
        if (prevGroup !== undefined && action.group !== prevGroup) {
            items.push(<DropdownMenuSeparator key={`sep-${action.id}`} />)
        }
        prevGroup = action.group
        items.push(
            <DropdownMenuItem
                key={action.id}
                disabled={action.disabled}
                variant={action.danger ? 'destructive' : 'default'}
                onClick={() => {
                    close()
                    if (action.disabled) return
                    const ctx: ActionRunContext = { source: 'context-menu', args: runArgs }
                    void action.run(ctx)
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

    if (!open) return null
    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuContent
                anchor={anchor}
                side='bottom'
                align='start'
                className={className}
                // A context menu is opened at a virtual point (no real
                // trigger), so base-ui's default "restore focus to whatever
                // had it before" steals focus away from anything an action's
                // run() might mount (e.g. the rename-file input the "New
                // file…" action shows). Opt out — actions that need focus
                // will grab it themselves.
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
