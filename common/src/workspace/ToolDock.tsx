import { useDroppable } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'

import { cn } from '@hollowcube/design-system'

import { renderTabViaRegistry, useWorkspaceContext } from './context'
import { makeDragData } from './drag-data'
import { TabBar } from './TabBar'
import { type DockId, type ToolDockState } from './types'

type ToolDockProps = {
    dockId: DockId
    state: ToolDockState
    /** When true, render the primary-tinted drop ring on the pane. Driven by
     *  the parent workspace via onDragOver so the ring stays on while any
     *  inner droppable (tab, content) is hovered. */
    highlightDrop?: boolean
    onActivate: (tabId: string) => void
    onClose: (tabId: string) => void
}

export function ToolDock({
    dockId,
    state,
    highlightDrop = false,
    onActivate,
    onClose,
}: ToolDockProps) {
    const { tabRegistry, renderEmpty, renderToolDockAdd, onTabContextMenu } = useWorkspaceContext()
    const paneId = `tool:${dockId}`
    const { setNodeRef } = useDroppable({
        id: paneId,
        data: makeDragData({ kind: 'tool-dock', dockId }),
    })

    const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]
    const tabIds = state.tabs.map((t) => t.id)
    const isEmpty = state.tabs.length === 0

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'bg-surface flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-xl',
                highlightDrop && 'ring-primary ring-2 ring-inset',
            )}
            data-slot='workspace-tool-dock'
            data-dock-id={dockId}
        >
            {isEmpty ? null : (
                <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
                    <TabBar
                        paneId={paneId}
                        tabs={state.tabs}
                        activeId={state.activeId}
                        onActivate={onActivate}
                        onClose={onClose}
                        onContextMenu={onTabContextMenu}
                        trailing={renderToolDockAdd?.(dockId)}
                    />
                </SortableContext>
            )}
            <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
                {activeTab ? (
                    renderTabViaRegistry(tabRegistry, activeTab)
                ) : renderEmpty ? (
                    renderEmpty(dockId)
                ) : (
                    <EmptyContent />
                )}
            </div>
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
