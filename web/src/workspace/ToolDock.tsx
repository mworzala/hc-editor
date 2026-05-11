import { useDroppable } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable'
import { cn } from '@hollowcube/design-system/lib/utils'

import { TabBar } from './TabBar'
import { type DockId, type TabRenderer, type ToolDockState } from './types'

type ToolDockProps = {
    dockId: DockId
    state: ToolDockState
    renderTab: TabRenderer
    onActivate: (tabId: string) => void
    onClose: (tabId: string) => void
}

export function ToolDock({ dockId, state, renderTab, onActivate, onClose }: ToolDockProps) {
    const paneId = `tool:${dockId}`
    const { setNodeRef, isOver } = useDroppable({
        id: paneId,
        data: { kind: 'tool-dock' as const, dockId },
    })

    const activeTab = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]
    const tabIds = state.tabs.map((t) => t.id)

    return (
        <div
            ref={setNodeRef}
            className={cn(
                'border-border bg-card flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-md border',
                isOver && 'ring-primary ring-2 ring-inset',
            )}
            data-slot='workspace-tool-dock'
            data-dock-id={dockId}
        >
            <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
                <TabBar
                    paneId={paneId}
                    tabs={state.tabs}
                    activeId={state.activeId}
                    onActivate={onActivate}
                    onClose={onClose}
                />
            </SortableContext>
            <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
                {activeTab ? renderTab(activeTab) : <EmptyContent />}
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
