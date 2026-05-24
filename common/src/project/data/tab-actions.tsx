import { useCallback, useMemo, useState } from 'react'

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuSeparator,
} from '@hollowcube/design-system'

import { useLayout, type WorkspaceLayoutService } from '../../model/workspace'
import { findLeaf, type TabLocation, type WorkspaceState } from '../../workspace'

// Tab context menu (right-click on a tab). The workspace primitive surfaces
// the click via `onTabContextMenu`; this module renders the menu and routes
// each option to a `layout.*` call.
//
// `editor.closeFocusedTab` (the Cmd+W action) used to live here too; it's
// since moved into `WorkspaceLayoutService.constructor` along with the
// other workspace actions.

type TabCtxState =
    | { open: false }
    | { open: true; paneId: string; tabId: string; x: number; y: number }

type VirtualElement = { getBoundingClientRect: () => DOMRect }

function pointRect(x: number, y: number): DOMRect {
    return {
        x,
        y,
        left: x,
        top: y,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
        toJSON() {
            return undefined
        },
    } as DOMRect
}

// --- ContextMenu host ---

export function useTabContextMenu() {
    const layout = useLayout()
    const [state, setState] = useState<TabCtxState>({ open: false })

    const onTabContextMenu = useCallback(
        (info: { paneId: string; tabId: string; x: number; y: number }) => {
            setState({ open: true, ...info })
        },
        [],
    )

    const close = useCallback(() => setState({ open: false }), [])

    const node = state.open ? (
        <TabContextMenu state={state} onClose={close} layout={layout} />
    ) : null

    return { onTabContextMenu, node }
}

function TabContextMenu({
    state,
    onClose,
    layout,
}: {
    state: Extract<TabCtxState, { open: true }>
    onClose: () => void
    layout: WorkspaceLayoutService
}) {
    const anchor = useMemo<VirtualElement>(
        () => ({ getBoundingClientRect: () => pointRect(state.x, state.y) }),
        [state.x, state.y],
    )

    const loc = useMemo(() => paneIdToLocation(state.paneId), [state.paneId])
    const siblings = useMemo(
        () => listSiblingIds(layout.state.peek(), loc),
        [layout, loc],
    )
    const targetIdx = siblings.indexOf(state.tabId)
    const hasLeft = targetIdx > 0
    const hasRight = targetIdx !== -1 && targetIdx < siblings.length - 1
    const hasOthers = siblings.length > 1

    const close = (ids: string[]) => {
        // Close in reverse order so indices stay stable (closeTab prunes empty
        // leaves; with reverse order the surviving ids stay in their slots).
        for (const id of ids.toReversed()) {
            layout.closeTab(loc, id)
        }
        onClose()
    }

    return (
        <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
            <DropdownMenuPortal>
                <DropdownMenuContent anchor={anchor} side='bottom' align='start' className='w-48'>
                    <DropdownMenuItem onClick={() => close([state.tabId])}>Close</DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={!hasOthers}
                        onClick={() => close(siblings.filter((id) => id !== state.tabId))}
                    >
                        Close Others
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        disabled={!hasLeft}
                        onClick={() => close(siblings.slice(0, targetIdx))}
                    >
                        Close Tabs to the Left
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        disabled={!hasRight}
                        onClick={() => close(siblings.slice(targetIdx + 1))}
                    >
                        Close Tabs to the Right
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => close(siblings)}>Close All</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenu>
    )
}

function paneIdToLocation(paneId: string): TabLocation {
    if (paneId.startsWith('tool:')) {
        const dock = paneId.slice('tool:'.length) as 'left' | 'right' | 'bottom'
        return { kind: 'tool', dock }
    }
    const leafId = paneId.slice('editor:'.length)
    return { kind: 'editor', leafId }
}

function listSiblingIds(state: WorkspaceState, loc: TabLocation): string[] {
    if (loc.kind === 'tool') {
        return state[loc.dock].tabs.map((t) => t.id)
    }
    const leaf = findLeaf(state.center, loc.leafId)
    return leaf ? leaf.tabs.map((t) => t.id) : []
}
