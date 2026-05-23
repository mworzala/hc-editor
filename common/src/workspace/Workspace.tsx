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

import {
    findLeaf,
    selectTabLocations,
    useActiveDrag,
    useDocksVisible,
    useHoveredPaneId,
    useLayout,
    useLayoutState,
    type WorkspaceLayoutService,
} from '../model/workspace'
import { TOGGLE_ANIM_MS } from './constants'
import { WorkspaceProvider } from './context'
import { readDragData } from './drag-data'
import { EditorGroup } from './EditorGroup'
import { ResizeHandle } from './ResizeHandle'
import { ToolDock } from './ToolDock'
import { type DockId, type DragSide, type Tab, type TabRegistry, type WorkspaceState } from './types'

type WorkspaceProps = {
    /** Render inside a tool dock that has no tabs. Used by hosts to surface a
     *  "drag a tool here" empty state. If omitted a minimal placeholder is shown. */
    renderEmpty?: (dockId: DockId) => React.ReactNode
    /** Render at the end of a tool dock's tab bar when it has tabs. Used by
     *  hosts to surface an "add tab" affordance. */
    renderToolDockAdd?: (dockId: DockId) => React.ReactNode
    /** Fires when the user right-clicks a tab. The host owns the menu. */
    onTabContextMenu?: (info: { paneId: string; tabId: string; x: number; y: number }) => void
    tabRegistry: TabRegistry
    className?: string
}

export function Workspace({
    tabRegistry,
    renderEmpty,
    renderToolDockAdd,
    onTabContextMenu,
    className,
}: WorkspaceProps) {
    const ctxValue = React.useMemo(
        () => ({ tabRegistry, renderEmpty, renderToolDockAdd, onTabContextMenu }),
        [tabRegistry, renderEmpty, renderToolDockAdd, onTabContextMenu],
    )
    return (
        <WorkspaceProvider value={ctxValue}>
            <WorkspaceInner className={className} />
        </WorkspaceProvider>
    )
}

function WorkspaceInner({ className }: { className?: string }) {
    const layout = useLayout()
    const state = useLayoutState()
    const activeDrag = useActiveDrag()
    const hoveredPaneId = useHoveredPaneId()
    const docksVisible = useDocksVisible()

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

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
    const prevVisibilityRef = React.useRef(docksVisible)
    React.useEffect(() => {
        const prev = prevVisibilityRef.current
        if (
            prev.left !== docksVisible.left ||
            prev.right !== docksVisible.right ||
            prev.bottom !== docksVisible.bottom
        ) {
            runToggleAnim()
            prevVisibilityRef.current = docksVisible
        }
    }, [docksVisible, runToggleAnim])

    const onDragStart = (e: DragStartEvent) => {
        const data = readDragData(e.active)
        if (data?.kind !== 'tab') return
        const locator = tabLocations.get(data.tabId)
        if (!locator) return
        const tab = lookupTab(state, locator, data.tabId)
        if (!tab) return
        layout.setActiveDrag({
            tab,
            sourcePaneId: data.paneId,
            sourceKind: locator.kind === 'tool' ? 'tool' : 'editor',
            sourceLocator: locator,
        })
    }

    const onDragCancel = () => {
        layout.setActiveDrag(null)
        layout.setHoveredPaneId(null)
    }

    const onDragOver = (event: DragOverEvent) => {
        if (!event.over) {
            layout.setHoveredPaneId(null)
            return
        }
        const overData = readDragData(event.over)
        if (overData?.kind === 'tab') {
            const loc = tabLocations.get(overData.tabId)
            if (!loc) return
            layout.setHoveredPaneId(
                loc.kind === 'tool' ? `tool:${loc.dock}` : `editor:${loc.leafId}`,
            )
            return
        }
        if (overData?.kind === 'tool-dock') {
            layout.setHoveredPaneId(`tool:${overData.dockId}`)
            return
        }
        if (overData?.kind === 'editor-leaf' || overData?.kind === 'split-edge') {
            layout.setHoveredPaneId(`editor:${overData.leafId}`)
            return
        }
        layout.setHoveredPaneId(null)
    }

    const onDragEnd = (event: DragEndEvent) => {
        const drag = activeDrag
        layout.setActiveDrag(null)
        layout.setHoveredPaneId(null)
        if (!drag || !event.over) return
        const overData = readDragData(event.over)
        if (!overData) return

        if (overData.kind === 'tab') {
            const overLoc = tabLocations.get(overData.tabId)
            if (!overLoc) return
            if (overLoc.kind !== drag.sourceLocator.kind) return

            if (
                overLoc.kind === 'tool' &&
                drag.sourceLocator.kind === 'tool' &&
                overLoc.dock === drag.sourceLocator.dock
            ) {
                const tabs = state[overLoc.dock].tabs
                const fromIdx = tabs.findIndex((t) => t.id === drag.tab.id)
                const toIdx = tabs.findIndex((t) => t.id === overData.tabId)
                if (fromIdx !== -1 && toIdx !== -1) {
                    layout.reorderTabs({ kind: 'tool', dock: overLoc.dock }, fromIdx, toIdx)
                }
                return
            }
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
                    layout.reorderTabs(
                        { kind: 'editor', leafId: overLoc.leafId },
                        fromIdx,
                        toIdx,
                    )
                }
                return
            }
            const targetIndex =
                overLoc.kind === 'tool'
                    ? state[overLoc.dock].tabs.findIndex((t) => t.id === overData.tabId)
                    : (findLeaf(state.center, overLoc.leafId)?.tabs.findIndex(
                          (t) => t.id === overData.tabId,
                      ) ?? 0)
            layout.moveTab(drag.sourceLocator, overLoc, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'tool-dock' && drag.sourceKind === 'tool') {
            const dock = overData.dockId
            const targetIndex = state[dock].tabs.length
            layout.moveTab(drag.sourceLocator, { kind: 'tool', dock }, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'editor-leaf' && drag.sourceKind === 'editor') {
            const leaf = findLeaf(state.center, overData.leafId)
            if (!leaf) return
            const targetIndex = leaf.tabs.length
            layout.moveTab(
                drag.sourceLocator,
                { kind: 'editor', leafId: overData.leafId },
                drag.tab.id,
                targetIndex,
            )
            return
        }

        if (overData.kind === 'split-edge' && drag.sourceKind === 'editor') {
            layout.splitLeafWithTab(
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
                    'bg-background flex h-full w-full min-w-0 flex-col',
                    toggleAnim && 'workspace-animating',
                    className,
                )}
                data-slot='workspace'
            >
                <div className='min-h-0 flex-1 px-2 pb-2'>
                    <ShellLayout
                        layout={layout}
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
    layout: WorkspaceLayoutService
    state: WorkspaceState
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

function ShellLayout({ layout, state, activeDragKind, hoveredPaneId }: ShellLayoutProps) {
    const [leftSizeRef, commitLeft] = useLastSize(state.columnSizes[0] || 18)
    const [rightSizeRef, commitRight] = useLastSize(state.columnSizes[2] || 18)
    const [bottomSizeRef, commitBottom] = useLastSize(state.middleSizes[1] || 30)

    const onColumnsChanged = (panes: Record<string, number>) => {
        const l = panes.left ?? 0
        const m = panes.middle ?? 100
        const r = panes.right ?? 0
        layout.setColumnSizes([l, m, r])
        commitLeft(l)
        commitRight(r)
    }
    const onMiddleChanged = (panes: Record<string, number>) => {
        const c = panes.center ?? 100
        const b = panes.bottom ?? 0
        layout.setMiddleSizes([c, b])
        commitBottom(b)
    }

    const { left: lVisible, right: rVisible, bottom: bVisible } = state.docksVisible
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
                                layout.activateTab({ kind: 'tool', dock: 'left' }, id)
                            }
                            onClose={(id) => layout.closeTab({ kind: 'tool', dock: 'left' }, id)}
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
                                layout.activateTab({ kind: 'editor', leafId }, tabId)
                            }
                            onClose={(leafId, tabId) =>
                                layout.closeTab({ kind: 'editor', leafId }, tabId)
                            }
                            onFocus={(leafId) => layout.setFocusedLeaf(leafId)}
                            onSplitResize={(splitId, sizes) =>
                                layout.setLeafSplitSizes(splitId, sizes)
                            }
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
                                        layout.activateTab({ kind: 'tool', dock: 'bottom' }, id)
                                    }
                                    onClose={(id) =>
                                        layout.closeTab({ kind: 'tool', dock: 'bottom' }, id)
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
                                layout.activateTab({ kind: 'tool', dock: 'right' }, id)
                            }
                            onClose={(id) =>
                                layout.closeTab({ kind: 'tool', dock: 'right' }, id)
                            }
                        />
                    </Panel>
                </>
            ) : null}
        </Group>
    )
}

function lookupTab(
    state: WorkspaceState,
    loc: { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string },
    tabId: string,
): Tab | null {
    if (loc.kind === 'tool') {
        return state[loc.dock].tabs.find((t) => t.id === tabId) ?? null
    }
    const leaf = findLeaf(state.center, loc.leafId)
    return leaf?.tabs.find((t) => t.id === tabId) ?? null
}
