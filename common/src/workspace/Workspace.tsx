import * as React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
} from '@dnd-kit/core'

import { cn } from '@hollowcube/design-system'

import { TOGGLE_ANIM_MS } from './constants'
import { WorkspaceProvider, useWorkspaceContext, type WorkspaceStoreHook } from './context'
import { readDragData } from './drag-data'
import { EditorGroup } from './EditorGroup'
import { ResizeHandle } from './ResizeHandle'
import { findLeaf, selectTabLocations, type WorkspaceStore } from './store'
import { ToolDock } from './ToolDock'
import { type DockId, type DragSide, type Tab, type TabRegistry } from './types'

type WorkspaceProps = {
    useStore: WorkspaceStoreHook
    tabRegistry: TabRegistry
    /** Render inside a tool dock that has no tabs. Used by hosts to surface a
     *  "drag a tool here" empty state. If omitted a minimal placeholder is shown. */
    renderEmpty?: (dockId: DockId) => React.ReactNode
    /** Render at the end of a tool dock's tab bar when it has tabs. Used by
     *  hosts to surface an "add tab" affordance. */
    renderToolDockAdd?: (dockId: DockId) => React.ReactNode
    /** Fires when the user right-clicks a tab. The host owns the menu. */
    onTabContextMenu?: (info: { paneId: string; tabId: string; x: number; y: number }) => void
    className?: string
}

export function Workspace({
    useStore,
    tabRegistry,
    renderEmpty,
    renderToolDockAdd,
    onTabContextMenu,
    className,
}: WorkspaceProps) {
    const ctxValue = React.useMemo(
        () => ({ useStore, tabRegistry, renderEmpty, renderToolDockAdd, onTabContextMenu }),
        [useStore, tabRegistry, renderEmpty, renderToolDockAdd, onTabContextMenu],
    )
    return (
        <WorkspaceProvider value={ctxValue}>
            <WorkspaceInner className={className} />
        </WorkspaceProvider>
    )
}

function WorkspaceInner({ className }: { className?: string }) {
    const { useStore } = useWorkspaceContext()
    const state = useStore()
    // Drag state lives on the store now (see store.activeDrag / hoveredPaneId).
    // We read it back so existing layout components keep their shape.
    const activeDrag = state.activeDrag
    const hoveredPaneId = state.hoveredPaneId

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

    // Derived map of every tabId → its location. Zustand returns a fresh
    // top-level object on every mutation, so depending on `state` is enough —
    // we don't need to enumerate slices.
    const tabLocations = React.useMemo(() => selectTabLocations(state), [state])

    const [toggleAnim, setToggleAnim] = React.useState(false)
    const toggleAnimTimer = React.useRef<number | null>(null)
    const runToggleAnim = React.useCallback(() => {
        setToggleAnim(true)
        if (toggleAnimTimer.current) window.clearTimeout(toggleAnimTimer.current)
        toggleAnimTimer.current = window.setTimeout(() => setToggleAnim(false), TOGGLE_ANIM_MS)
    }, [])

    // React to visibility changes triggered from outside (e.g. top-bar buttons)
    // so the resize animation still plays. We snapshot the previous visibility
    // and run the animation when it changes.
    const prevVisibilityRef = React.useRef(state.docksVisible)
    React.useEffect(() => {
        const prev = prevVisibilityRef.current
        const cur = state.docksVisible
        if (prev.left !== cur.left || prev.right !== cur.right || prev.bottom !== cur.bottom) {
            runToggleAnim()
            prevVisibilityRef.current = cur
        }
    }, [state.docksVisible, runToggleAnim])

    const onDragStart = (e: DragStartEvent) => {
        const data = readDragData(e.active)
        if (data?.kind !== 'tab') return
        const locator = tabLocations.get(data.tabId)
        if (!locator) return
        const tab = lookupTab(state, locator, data.tabId)
        if (!tab) return
        state.setActiveDrag({
            tab,
            sourcePaneId: data.paneId,
            sourceKind: locator.kind === 'tool' ? 'tool' : 'editor',
            sourceLocator: locator,
        })
    }

    const onDragCancel = () => {
        state.setActiveDrag(null)
        state.setHoveredPaneId(null)
    }

    const onDragOver = (event: DragOverEvent) => {
        if (!event.over) {
            state.setHoveredPaneId(null)
            return
        }
        const overData = readDragData(event.over)
        if (overData?.kind === 'tab') {
            const loc = tabLocations.get(overData.tabId)
            if (!loc) return
            state.setHoveredPaneId(
                loc.kind === 'tool' ? `tool:${loc.dock}` : `editor:${loc.leafId}`,
            )
            return
        }
        if (overData?.kind === 'tool-dock') {
            state.setHoveredPaneId(`tool:${overData.dockId}`)
            return
        }
        if (overData?.kind === 'editor-leaf' || overData?.kind === 'split-edge') {
            state.setHoveredPaneId(`editor:${overData.leafId}`)
            return
        }
        state.setHoveredPaneId(null)
    }

    const onDragEnd = (event: DragEndEvent) => {
        const drag = activeDrag
        state.setActiveDrag(null)
        state.setHoveredPaneId(null)
        if (!drag || !event.over) return
        const overData = readDragData(event.over)
        if (!overData) return

        if (overData.kind === 'tab') {
            const overLoc = tabLocations.get(overData.tabId)
            if (!overLoc) return
            if (overLoc.kind !== drag.sourceLocator.kind) return

            // Reorder within same dock
            if (
                overLoc.kind === 'tool' &&
                drag.sourceLocator.kind === 'tool' &&
                overLoc.dock === drag.sourceLocator.dock
            ) {
                const tabs = state[overLoc.dock].tabs
                const fromIdx = tabs.findIndex((t) => t.id === drag.tab.id)
                const toIdx = tabs.findIndex((t) => t.id === overData.tabId)
                if (fromIdx !== -1 && toIdx !== -1) {
                    state.reorderTabs({ kind: 'tool', dock: overLoc.dock }, fromIdx, toIdx)
                }
                return
            }
            // Reorder within same leaf
            if (
                overLoc.kind === 'editor' &&
                drag.sourceLocator.kind === 'editor' &&
                overLoc.leafId === drag.sourceLocator.leafId
            ) {
                const leaf = findLeaf(state.center, overLoc.leafId)
                if (!leaf) return
                const fromIdx = leaf.tabs.findIndex((t) => t.id === drag.tab.id)
                const toIdx = leaf.tabs.findIndex((t) => t.id === overData.tabId)
                if (fromIdx !== -1 && toIdx !== -1) {
                    state.reorderTabs({ kind: 'editor', leafId: overLoc.leafId }, fromIdx, toIdx)
                }
                return
            }
            // Move across panes
            const targetIndex =
                overLoc.kind === 'tool'
                    ? state[overLoc.dock].tabs.findIndex((t) => t.id === overData.tabId)
                    : (findLeaf(state.center, overLoc.leafId)?.tabs.findIndex(
                          (t) => t.id === overData.tabId,
                      ) ?? 0)
            state.moveTab(drag.sourceLocator, overLoc, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'tool-dock' && drag.sourceKind === 'tool') {
            const dock = overData.dockId
            const targetIndex = state[dock].tabs.length
            state.moveTab(drag.sourceLocator, { kind: 'tool', dock }, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'editor-leaf' && drag.sourceKind === 'editor') {
            const leaf = findLeaf(state.center, overData.leafId)
            if (!leaf) return
            const targetIndex = leaf.tabs.length
            state.moveTab(
                drag.sourceLocator,
                { kind: 'editor', leafId: overData.leafId },
                drag.tab.id,
                targetIndex,
            )
            return
        }

        if (overData.kind === 'split-edge' && drag.sourceKind === 'editor') {
            state.splitLeafWithTab(
                overData.leafId,
                overData.side as DragSide,
                drag.sourceLocator,
                drag.tab.id,
            )
        }
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
        >
            <div
                className={cn(
                    'flex h-full w-full min-w-0 flex-col bg-background',
                    toggleAnim && 'workspace-animating',
                    className,
                )}
                data-slot='workspace'
            >
                <div className='min-h-0 flex-1 px-2 pb-2'>
                    <ShellLayout
                        state={state}
                        activeDragKind={activeDrag?.sourceKind ?? null}
                        hoveredPaneId={hoveredPaneId}
                    />
                </div>
            </div>

            <DragOverlay dropAnimation={null}>
                {activeDrag ? (
                    <div className='border-primary bg-popover ring-primary/30 pointer-events-none flex items-center gap-1 rounded-md border px-3 py-1 text-[0.75rem] shadow-lg ring-1'>
                        <span>{activeDrag.tab.title}</span>
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    )
}

type ShellLayoutProps = {
    state: WorkspaceStore
    activeDragKind: 'tool' | 'editor' | null
    hoveredPaneId: string | null
}

function useLastSize(initial: number) {
    const ref = React.useRef(initial)
    const commit = React.useCallback((v: number) => {
        if (v > 1) ref.current = v
    }, [])
    return [ref, commit] as const
}

function ShellLayout({ state, activeDragKind, hoveredPaneId }: ShellLayoutProps) {
    // Remember each dock's last non-zero size so toggling it back on restores
    // roughly where the user left it. One hook per dock, no manual bookkeeping.
    const [leftSizeRef, commitLeft] = useLastSize(state.columnSizes[0] || 18)
    const [rightSizeRef, commitRight] = useLastSize(state.columnSizes[2] || 18)
    const [bottomSizeRef, commitBottom] = useLastSize(state.middleSizes[1] || 30)

    const onColumnsChanged = (layout: Record<string, number>) => {
        const l = layout.left ?? 0
        const m = layout.middle ?? 100
        const r = layout.right ?? 0
        state.setColumnSizes([l, m, r])
        commitLeft(l)
        commitRight(r)
    }
    const onMiddleChanged = (layout: Record<string, number>) => {
        const c = layout.center ?? 100
        const b = layout.bottom ?? 0
        state.setMiddleSizes([c, b])
        commitBottom(b)
    }

    const { left: lVisible, right: rVisible, bottom: bVisible } = state.docksVisible
    // Key forces a Group remount when the set of visible docks changes so the
    // lib re-computes layout from defaultSize without us fighting its
    // imperative API.
    const columnsKey = `cols:${lVisible ? 1 : 0}:${rVisible ? 1 : 0}`
    const middleKey = `middle:${bVisible ? 1 : 0}`

    const leftSize = lVisible ? leftSizeRef.current : 0
    const rightSize = rVisible ? rightSizeRef.current : 0
    const middleSize = Math.max(20, 100 - leftSize - rightSize)
    const bottomSize = bVisible ? bottomSizeRef.current : 0
    const centerSize = Math.max(20, 100 - bottomSize)

    return (
        <Group
            key={columnsKey}
            orientation='horizontal'
            onLayoutChanged={onColumnsChanged}
            className='flex h-full w-full'
            style={{ display: 'flex' }}
        >
            {lVisible ? (
                <>
                    <Panel id='left' defaultSize={leftSize} minSize={6}>
                        <ToolDock
                            dockId='left'
                            state={state.left}
                            highlightDrop={
                                activeDragKind === 'tool' && hoveredPaneId === 'tool:left'
                            }
                            onActivate={(id) =>
                                state.activateTab({ kind: 'tool', dock: 'left' }, id)
                            }
                            onClose={(id) => state.closeTab({ kind: 'tool', dock: 'left' }, id)}
                        />
                    </Panel>
                    <Separator>
                        <ResizeHandle orientation='horizontal' />
                    </Separator>
                </>
            ) : null}
            <Panel id='middle' defaultSize={middleSize} minSize={20}>
                <Group
                    key={middleKey}
                    orientation='vertical'
                    onLayoutChanged={onMiddleChanged}
                    className='flex h-full w-full flex-col'
                    style={{ display: 'flex' }}
                >
                    <Panel id='center' defaultSize={centerSize} minSize={20}>
                        <EditorGroup
                            node={state.center}
                            activeDragKind={activeDragKind}
                            hoveredPaneId={hoveredPaneId}
                            focusedLeafId={state.focusedLeafId}
                            onActivate={(leafId, tabId) =>
                                state.activateTab({ kind: 'editor', leafId }, tabId)
                            }
                            onClose={(leafId, tabId) =>
                                state.closeTab({ kind: 'editor', leafId }, tabId)
                            }
                            onFocus={(leafId) => state.setFocusedLeaf(leafId)}
                            onSplitResize={state.setLeafSplitSizes}
                        />
                    </Panel>
                    {bVisible ? (
                        <>
                            <Separator>
                                <ResizeHandle orientation='vertical' />
                            </Separator>
                            <Panel id='bottom' defaultSize={bottomSize} minSize={6}>
                                <ToolDock
                                    dockId='bottom'
                                    state={state.bottom}
                                    highlightDrop={
                                        activeDragKind === 'tool' && hoveredPaneId === 'tool:bottom'
                                    }
                                    onActivate={(id) =>
                                        state.activateTab({ kind: 'tool', dock: 'bottom' }, id)
                                    }
                                    onClose={(id) =>
                                        state.closeTab({ kind: 'tool', dock: 'bottom' }, id)
                                    }
                                />
                            </Panel>
                        </>
                    ) : null}
                </Group>
            </Panel>
            {rVisible ? (
                <>
                    <Separator>
                        <ResizeHandle orientation='horizontal' />
                    </Separator>
                    <Panel id='right' defaultSize={rightSize} minSize={6}>
                        <ToolDock
                            dockId='right'
                            state={state.right}
                            highlightDrop={
                                activeDragKind === 'tool' && hoveredPaneId === 'tool:right'
                            }
                            onActivate={(id) =>
                                state.activateTab({ kind: 'tool', dock: 'right' }, id)
                            }
                            onClose={(id) => state.closeTab({ kind: 'tool', dock: 'right' }, id)}
                        />
                    </Panel>
                </>
            ) : null}
        </Group>
    )
}

function lookupTab(state: WorkspaceStore, loc: TabLocationLite, tabId: string): Tab | null {
    if (loc.kind === 'tool') {
        return state[loc.dock].tabs.find((t) => t.id === tabId) ?? null
    }
    const leaf = findLeaf(state.center, loc.leafId)
    return leaf?.tabs.find((t) => t.id === tabId) ?? null
}

type TabLocationLite = { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string }
