import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    DropdownMenuSeparator,
} from '@hollowcube/design-system'

import { useLayout, type WorkspaceLayoutService } from '../../model/workspace'
import { usePlatform } from '../../platform'
import {
    findFirstLeaf,
    findLeaf,
    type Tab,
    type TabLocation,
    type WorkspaceState,
} from '../../workspace'
import { useRegisterAction } from '../actions'

// Host-level tab actions. Two surfaces:
//
//   • <TabContextMenu />     — right-click menu over a tab. Wires up via the
//                              workspace primitive's `onTabContextMenu` hook.
//   • <CloseFocusedTabAction />  — registers Ctrl/Cmd+W (desktop only) to
//                                  close the focused leaf's active editor tab.
//
// Both live in the project layer because the workspace primitive is
// intentionally menu-agnostic — it just surfaces the right-click event.

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

// --- Ctrl/Cmd+W action (desktop only) ---

export function CloseFocusedTabAction() {
    const { kind: platform } = usePlatform()
    const layout = useLayout()

    const handler = useCallback(() => {
        const state = layout.state.peek()
        const focused = focusedLeafTab(state)
        if (!focused) return
        layout.closeTab({ kind: 'editor', leafId: focused.leafId }, focused.tab.id)
    }, [layout])

    const action = useMemo(
        () => ({
            id: 'editor.closeFocusedTab',
            title: 'Close Tab',
            keybinding: '$mod+w',
            contexts: ['global'],
            menu: { path: 'file' as const, group: 'tabs', order: 20 },
            run: handler,
        }),
        [handler],
    )

    // Web browsers reserve Cmd/Ctrl+W for the tab/window close action. Only
    // register the hotkey when running inside the desktop shell.
    const Bridge = platform === 'desktop' ? RegisterBridge : NoopRegister
    return <Bridge action={action} />
}

function RegisterBridge({ action }: { action: Parameters<typeof useRegisterAction>[0] }) {
    useRegisterAction(action)
    return null
}

function NoopRegister(_props: { action: unknown }): ReactNode {
    return null
}

function focusedLeafTab(state: WorkspaceState): { leafId: string; tab: Tab } | null {
    const focusedId = state.focusedLeafId
    let leafId = focusedId
    let leaf = focusedId ? findLeaf(state.center, focusedId) : null
    if (!leaf) {
        leaf = findFirstLeaf(state.center)
        leafId = leaf.id
    }
    const active = leaf.tabs.find((t) => t.id === leaf!.activeId) ?? leaf.tabs[0]
    if (!active || !leafId) return null
    return { leafId, tab: active }
}
