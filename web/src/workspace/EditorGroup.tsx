import { useDroppable } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@hollowcube/design-system/lib/utils'
import { Group, Panel, Separator } from 'react-resizable-panels'

import { ResizeHandle } from './ResizeHandle'
import { TabBar } from './TabBar'
import { type EditorGroupNode, type TabRenderer } from './types'

type EditorGroupProps = {
    node: EditorGroupNode
    activeDragKind: 'tool' | 'editor' | null
    renderTab: TabRenderer
    onActivate: (leafId: string, tabId: string) => void
    onClose: (leafId: string, tabId: string) => void
    onSplitResize: (splitId: string, sizes: [number, number]) => void
}

export function EditorGroup(props: EditorGroupProps) {
    if (props.node.kind === 'split') return <SplitNode {...props} node={props.node} />
    return <LeafNode {...props} node={props.node} />
}

function SplitNode({
    node,
    onSplitResize,
    ...rest
}: EditorGroupProps & { node: Extract<EditorGroupNode, { kind: 'split' }> }) {
    const orientation = node.orientation
    const childAId = `${node.id}-a`
    const childBId = `${node.id}-b`

    return (
        <Group
            orientation={orientation}
            id={node.id}
            defaultLayout={{ [childAId]: node.sizes[0], [childBId]: node.sizes[1] }}
            onLayoutChanged={(layout) => {
                const a = layout[childAId]
                const b = layout[childBId]
                if (typeof a === 'number' && typeof b === 'number') {
                    onSplitResize(node.id, [a, b])
                }
            }}
            className='flex h-full w-full gap-1'
            style={{ display: 'flex' }}
        >
            <Panel id={childAId} defaultSize={node.sizes[0]} minSize={10}>
                <EditorGroup {...rest} node={node.children[0]} onSplitResize={onSplitResize} />
            </Panel>
            <Separator>
                <ResizeHandle orientation={orientation} />
            </Separator>
            <Panel id={childBId} defaultSize={node.sizes[1]} minSize={10}>
                <EditorGroup {...rest} node={node.children[1]} onSplitResize={onSplitResize} />
            </Panel>
        </Group>
    )
}

function LeafNode({
    node,
    activeDragKind,
    renderTab,
    onActivate,
    onClose,
}: EditorGroupProps & { node: Extract<EditorGroupNode, { kind: 'leaf' }> }) {
    const paneId = `editor:${node.id}`

    const tabsDroppable = useDroppable({
        id: paneId,
        data: { kind: 'editor-leaf' as const, leafId: node.id },
    })

    const showEdges = activeDragKind === 'editor'

    const activeTab = node.tabs.find((t) => t.id === node.activeId) ?? node.tabs[0]
    const tabIds = node.tabs.map((t) => t.id)

    return (
        <div
            ref={tabsDroppable.setNodeRef}
            className={cn(
                'relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card',
            )}
            data-slot='workspace-editor-leaf'
            data-leaf-id={node.id}
        >
            <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
                <TabBar
                    paneId={paneId}
                    tabs={node.tabs}
                    activeId={node.activeId}
                    onActivate={(id) => onActivate(node.id, id)}
                    onClose={(id) => onClose(node.id, id)}
                />
            </SortableContext>

            <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
                {activeTab ? renderTab(activeTab) : <EmptyContent />}
            </div>

            {showEdges ? <SplitDropZones leafId={node.id} /> : null}
        </div>
    )
}

function SplitDropZones({ leafId }: { leafId: string }) {
    return (
        <>
            <EdgeZone leafId={leafId} side='left' />
            <EdgeZone leafId={leafId} side='right' />
            <EdgeZone leafId={leafId} side='top' />
            <EdgeZone leafId={leafId} side='bottom' />
        </>
    )
}

type Side = 'left' | 'right' | 'top' | 'bottom'

function EdgeZone({ leafId, side }: { leafId: string; side: Side }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `split:${leafId}:${side}`,
        data: { kind: 'split-edge' as const, leafId, side },
    })

    const style: React.CSSProperties = {
        position: 'absolute',
        zIndex: 30,
    }
    if (side === 'left') Object.assign(style, { left: 0, top: 0, bottom: 0, width: '24%' })
    if (side === 'right') Object.assign(style, { right: 0, top: 0, bottom: 0, width: '24%' })
    if (side === 'top') Object.assign(style, { top: 0, left: 0, right: 0, height: '24%' })
    if (side === 'bottom') Object.assign(style, { bottom: 0, left: 0, right: 0, height: '24%' })

    return (
        <div ref={setNodeRef} style={style} data-side={side} data-leaf-id={leafId}>
            {isOver ? (
                <div className='bg-primary/20 ring-primary/60 pointer-events-none absolute inset-1 rounded-md ring-2 ring-inset' />
            ) : null}
        </div>
    )
}

function EmptyContent() {
    return (
        <div className='text-muted-foreground flex h-full items-center justify-center p-6 text-xs'>
            No active tab
        </div>
    )
}
