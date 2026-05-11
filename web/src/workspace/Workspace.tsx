import {
    DndContext,
    DragOverlay,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from '@dnd-kit/core'
import { cn } from '@hollowcube/design-system/lib/utils'
import * as React from 'react'
import { Group, Panel, type PanelImperativeHandle, Separator } from 'react-resizable-panels'

import { EditorGroup } from './EditorGroup'
import { ResizeHandle } from './ResizeHandle'
import { type WorkspaceStore } from './store'
import { ToolDock } from './ToolDock'
import {
    type DockId,
    type EditorGroupNode,
    type Tab,
    type TabRenderer,
    type ToolDockState,
} from './types'

type WorkspaceProps = {
    useStore: () => WorkspaceStore
    renderTab: TabRenderer
    className?: string
}

type ActiveDrag = {
    tab: Tab
    sourcePaneId: string
    sourceKind: 'tool' | 'editor'
    sourceLocator: { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string }
}

export function Workspace({ useStore, renderTab, className }: WorkspaceProps) {
    const state = useStore()
    const [activeDrag, setActiveDrag] = React.useState<ActiveDrag | null>(null)

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

    const [toggleAnim, setToggleAnim] = React.useState(false)
    const toggleAnimTimer = React.useRef<number | null>(null)
    const runToggleAnim = React.useCallback(() => {
        setToggleAnim(true)
        if (toggleAnimTimer.current) window.clearTimeout(toggleAnimTimer.current)
        toggleAnimTimer.current = window.setTimeout(() => setToggleAnim(false), 260)
    }, [])

    const onToggleDock = React.useCallback(
        (dock: DockId) => {
            runToggleAnim()
            state.toggleDock(dock)
        },
        [state, runToggleAnim],
    )

    const onDragStart = (e: DragStartEvent) => {
        const data = e.active.data.current as
            | { paneId?: string; tabId?: string; kind?: string }
            | undefined
        if (!data || data.kind !== 'tab' || !data.tabId || !data.paneId) return
        const located = locateTab(state, data.tabId)
        if (!located) return
        setActiveDrag({
            tab: located.tab,
            sourcePaneId: data.paneId,
            sourceKind: located.locator.kind === 'tool' ? 'tool' : 'editor',
            sourceLocator: located.locator,
        })
    }

    const onDragCancel = () => setActiveDrag(null)

    const onDragEnd = (event: DragEndEvent) => {
        const drag = activeDrag
        setActiveDrag(null)
        if (!drag || !event.over) return
        const overId = String(event.over.id)
        const overData = event.over.data.current as
            | { kind?: string; dockId?: DockId; leafId?: string; side?: string }
            | undefined

        if (overData === undefined || overData.kind === 'tab') {
            const overTabId = overId
            const overTab = locateTab(state, overTabId)
            if (!overTab) return
            if (overTab.locator.kind !== drag.sourceLocator.kind) return
            if (
                overTab.locator.kind === 'tool' &&
                drag.sourceLocator.kind === 'tool' &&
                overTab.locator.dock === drag.sourceLocator.dock
            ) {
                const tabs = state[overTab.locator.dock].tabs
                const fromIdx = tabs.findIndex((t) => t.id === drag.tab.id)
                const toIdx = tabs.findIndex((t) => t.id === overTabId)
                if (fromIdx !== -1 && toIdx !== -1) {
                    state.reorderTabs({ kind: 'tool', dock: overTab.locator.dock }, fromIdx, toIdx)
                }
                return
            }
            if (
                overTab.locator.kind === 'editor' &&
                drag.sourceLocator.kind === 'editor' &&
                overTab.locator.leafId === drag.sourceLocator.leafId
            ) {
                const leaf = findLeaf(state.center, overTab.locator.leafId)
                if (!leaf) return
                const fromIdx = leaf.tabs.findIndex((t) => t.id === drag.tab.id)
                const toIdx = leaf.tabs.findIndex((t) => t.id === overTabId)
                if (fromIdx !== -1 && toIdx !== -1) {
                    state.reorderTabs(
                        { kind: 'editor', leafId: overTab.locator.leafId },
                        fromIdx,
                        toIdx,
                    )
                }
                return
            }
            const targetIndex =
                overTab.locator.kind === 'tool'
                    ? state[overTab.locator.dock].tabs.findIndex((t) => t.id === overTabId)
                    : (findLeaf(state.center, overTab.locator.leafId)?.tabs.findIndex(
                          (t) => t.id === overTabId,
                      ) ?? 0)
            state.moveTab(drag.sourceLocator, overTab.locator, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'tool-dock' && drag.sourceKind === 'tool') {
            const dock = overData.dockId as DockId
            const targetIndex = state[dock].tabs.length
            state.moveTab(drag.sourceLocator, { kind: 'tool', dock }, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'editor-leaf' && drag.sourceKind === 'editor') {
            const leafId = overData.leafId as string
            const leaf = findLeaf(state.center, leafId)
            if (!leaf) return
            const targetIndex = leaf.tabs.length
            state.moveTab(drag.sourceLocator, { kind: 'editor', leafId }, drag.tab.id, targetIndex)
            return
        }

        if (overData.kind === 'split-edge' && drag.sourceKind === 'editor') {
            const leafId = overData.leafId as string
            const side = overData.side as 'left' | 'right' | 'top' | 'bottom'
            state.splitLeafWithTab(leafId, side, drag.sourceLocator, drag.tab.id)
        }
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
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
                <Toolbar state={state} onToggleDock={onToggleDock} />
                <div className='min-h-0 flex-1 p-1'>
                    <ShellLayout
                        state={state}
                        activeDragKind={activeDrag?.sourceKind ?? null}
                        renderTab={renderTab}
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
    renderTab: TabRenderer
}

function ShellLayout({ state, activeDragKind, renderTab }: ShellLayoutProps) {
    const leftRef = React.useRef<PanelImperativeHandle | null>(null)
    const rightRef = React.useRef<PanelImperativeHandle | null>(null)
    const bottomRef = React.useRef<PanelImperativeHandle | null>(null)

    React.useEffect(() => {
        const panel = leftRef.current
        if (!panel) return
        if (state.docksVisible.left) panel.resize(state.columnSizes[0])
        else panel.collapse()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.docksVisible.left])

    React.useEffect(() => {
        const panel = rightRef.current
        if (!panel) return
        if (state.docksVisible.right) panel.resize(state.columnSizes[2])
        else panel.collapse()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.docksVisible.right])

    React.useEffect(() => {
        const panel = bottomRef.current
        if (!panel) return
        if (state.docksVisible.bottom) panel.resize(state.middleSizes[1])
        else panel.collapse()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.docksVisible.bottom])

    const onColumnsChanged = (layout: Record<string, number>) => {
        const l = layout.left
        const m = layout.middle
        const r = layout.right
        if (typeof l === 'number' && typeof m === 'number' && typeof r === 'number') {
            state.setColumnSizes([l, m, r])
        }
    }
    const onMiddleChanged = (layout: Record<string, number>) => {
        const c = layout.center
        const b = layout.bottom
        if (typeof c === 'number' && typeof b === 'number') {
            state.setMiddleSizes([c, b])
        }
    }

    return (
        <Group
            orientation='horizontal'
            onLayoutChanged={onColumnsChanged}
            className='flex h-full w-full gap-1'
            style={{ display: 'flex' }}
        >
            <Panel
                id='left'
                panelRef={leftRef}
                defaultSize={state.columnSizes[0]}
                minSize={10}
                collapsible
                collapsedSize={0}
            >
                <ToolDock
                    dockId='left'
                    state={state.left}
                    renderTab={renderTab}
                    onActivate={(id) => state.activateTab({ kind: 'tool', dock: 'left' }, id)}
                    onClose={(id) => state.closeTab({ kind: 'tool', dock: 'left' }, id)}
                />
            </Panel>
            <Separator>
                <ResizeHandle orientation='horizontal' />
            </Separator>
            <Panel id='middle' defaultSize={state.columnSizes[1]} minSize={20}>
                <Group
                    orientation='vertical'
                    onLayoutChanged={onMiddleChanged}
                    className='flex h-full w-full flex-col gap-1'
                    style={{ display: 'flex' }}
                >
                    <Panel id='center' defaultSize={state.middleSizes[0]} minSize={20}>
                        <EditorGroup
                            node={state.center}
                            activeDragKind={activeDragKind}
                            renderTab={renderTab}
                            onActivate={(leafId, tabId) =>
                                state.activateTab({ kind: 'editor', leafId }, tabId)
                            }
                            onClose={(leafId, tabId) =>
                                state.closeTab({ kind: 'editor', leafId }, tabId)
                            }
                            onSplitResize={state.setLeafSplitSizes}
                        />
                    </Panel>
                    <Separator>
                        <ResizeHandle orientation='vertical' />
                    </Separator>
                    <Panel
                        id='bottom'
                        panelRef={bottomRef}
                        defaultSize={state.middleSizes[1]}
                        minSize={10}
                        collapsible
                        collapsedSize={0}
                    >
                        <ToolDock
                            dockId='bottom'
                            state={state.bottom}
                            renderTab={renderTab}
                            onActivate={(id) =>
                                state.activateTab({ kind: 'tool', dock: 'bottom' }, id)
                            }
                            onClose={(id) => state.closeTab({ kind: 'tool', dock: 'bottom' }, id)}
                        />
                    </Panel>
                </Group>
            </Panel>
            <Separator>
                <ResizeHandle orientation='horizontal' />
            </Separator>
            <Panel
                id='right'
                panelRef={rightRef}
                defaultSize={state.columnSizes[2]}
                minSize={10}
                collapsible
                collapsedSize={0}
            >
                <ToolDock
                    dockId='right'
                    state={state.right}
                    renderTab={renderTab}
                    onActivate={(id) => state.activateTab({ kind: 'tool', dock: 'right' }, id)}
                    onClose={(id) => state.closeTab({ kind: 'tool', dock: 'right' }, id)}
                />
            </Panel>
        </Group>
    )
}

function Toolbar({
    state,
    onToggleDock,
}: {
    state: WorkspaceStore
    onToggleDock: (dock: DockId) => void
}) {
    return (
        <div className='border-border bg-surface flex items-center gap-2 border-b px-3 py-1.5'>
            <ToggleButton
                active={state.docksVisible.left}
                onClick={() => onToggleDock('left')}
                label='Toggle left dock'
                glyph='L'
            />
            <ToggleButton
                active={state.docksVisible.bottom}
                onClick={() => onToggleDock('bottom')}
                label='Toggle bottom dock'
                glyph='B'
            />
            <ToggleButton
                active={state.docksVisible.right}
                onClick={() => onToggleDock('right')}
                label='Toggle right dock'
                glyph='R'
            />
            <div className='ml-auto flex items-center gap-2'>
                <button
                    type='button'
                    onClick={() => state.reset()}
                    className='border-border text-foreground hover:bg-muted rounded-md border bg-transparent px-2 py-0.5 text-[0.7rem]'
                >
                    Reset layout
                </button>
            </div>
        </div>
    )
}

function ToggleButton({
    active,
    onClick,
    label,
    glyph,
}: {
    active: boolean
    onClick: () => void
    label: string
    glyph: string
}) {
    return (
        <button
            type='button'
            onClick={onClick}
            aria-label={label}
            aria-pressed={active}
            className={cn(
                'inline-flex h-6 w-6 items-center justify-center rounded-sm border text-[0.7rem] font-medium transition-colors',
                active
                    ? 'bg-secondary text-secondary-foreground border-transparent'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground bg-transparent',
            )}
        >
            {glyph}
        </button>
    )
}

function locateTab(
    state: WorkspaceStore,
    tabId: string,
): {
    tab: Tab
    locator: { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string }
} | null {
    for (const dock of ['left', 'right', 'bottom'] as const) {
        const found = (state[dock] as ToolDockState).tabs.find((t) => t.id === tabId)
        if (found) return { tab: found, locator: { kind: 'tool', dock } }
    }
    const found = findTabInTree(state.center, tabId)
    if (found) return { tab: found.tab, locator: { kind: 'editor', leafId: found.leafId } }
    return null
}

function findTabInTree(node: EditorGroupNode, tabId: string): { tab: Tab; leafId: string } | null {
    if (node.kind === 'leaf') {
        const t = node.tabs.find((x) => x.id === tabId)
        return t ? { tab: t, leafId: node.id } : null
    }
    return findTabInTree(node.children[0], tabId) ?? findTabInTree(node.children[1], tabId)
}

function findLeaf(
    node: EditorGroupNode,
    leafId: string,
): Extract<EditorGroupNode, { kind: 'leaf' }> | null {
    if (node.kind === 'leaf') return node.id === leafId ? node : null
    return findLeaf(node.children[0], leafId) ?? findLeaf(node.children[1], leafId)
}
