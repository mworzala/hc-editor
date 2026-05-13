import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { XIcon } from 'lucide-react'

import { cn } from '@hollowcube/design-system'

import { makeDragData } from './drag-data'
import { type Tab } from './types'

type TabBarProps = {
    paneId: string
    tabs: Tab[]
    activeId: string | null
    onActivate: (id: string) => void
    onClose: (id: string) => void
    /** Optional host hook — fires on right-click of a tab so the host can
     *  render a context menu. The workspace primitive itself stays
     *  menu-agnostic. */
    onContextMenu?: (info: { paneId: string; tabId: string; x: number; y: number }) => void
    /** Rendered after the tab list — host slot for things like an "add tab" button. */
    trailing?: React.ReactNode
}

export function TabBar({
    paneId,
    tabs,
    activeId,
    onActivate,
    onClose,
    onContextMenu,
    trailing,
}: TabBarProps) {
    const scrollerRef = React.useRef<HTMLDivElement | null>(null)

    React.useEffect(() => {
        const el = scrollerRef.current
        if (!el) return
        const onWheel = (e: WheelEvent) => {
            if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
            e.preventDefault()
            el.scrollLeft += e.deltaY
        }
        el.addEventListener('wheel', onWheel, { passive: false })
        return () => el.removeEventListener('wheel', onWheel)
    }, [])

    return (
        <div
            ref={scrollerRef}
            className='flex w-full min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden px-1.5 pt-1.5'
            data-slot='workspace-tabbar'
        >
            {tabs.map((tab) => (
                <SortableTab
                    key={tab.id}
                    paneId={paneId}
                    tab={tab}
                    active={tab.id === activeId}
                    onActivate={onActivate}
                    onClose={onClose}
                    onContextMenu={
                        onContextMenu
                            ? (e) => {
                                  e.preventDefault()
                                  onContextMenu({
                                      paneId,
                                      tabId: tab.id,
                                      x: e.clientX,
                                      y: e.clientY,
                                  })
                              }
                            : undefined
                    }
                />
            ))}
            {tabs.length === 0 ? (
                <div className='text-muted-foreground px-2 py-1 text-[0.7rem]'>Empty</div>
            ) : null}
            {trailing}
        </div>
    )
}

type SortableTabProps = {
    paneId: string
    tab: Tab
    active: boolean
    onActivate: (id: string) => void
    onClose: (id: string) => void
    onContextMenu?: (e: React.MouseEvent) => void
}

function SortableTab({
    paneId,
    tab,
    active,
    onActivate,
    onClose,
    onContextMenu,
}: SortableTabProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tab.id,
        data: makeDragData({ kind: 'tab', paneId, tabId: tab.id }),
    })

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
            }}
            className={cn(
                'group/tab inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[0.75rem] leading-none select-none font-medium',
                'cursor-pointer transition-colors',
                active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-foreground/60 hover:bg-muted/40 hover:text-foreground',
                isDragging && 'opacity-40',
            )}
            onClick={() => onActivate(tab.id)}
            onContextMenu={onContextMenu}
            {...attributes}
            {...listeners}
        >
            <span className='truncate'>{tab.title}</span>
            <button
                type='button'
                aria-label={`Close ${tab.title}`}
                className={cn(
                    '-mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm',
                    active
                        ? 'opacity-70 hover:bg-foreground/10 hover:opacity-100'
                        : 'opacity-0 transition-opacity group-hover/tab:opacity-70 focus-visible:opacity-100 hover:bg-foreground/10',
                )}
                onClick={(e) => {
                    e.stopPropagation()
                    onClose(tab.id)
                }}
                onPointerDown={(e) => {
                    e.stopPropagation()
                }}
            >
                <XIcon className='size-3' />
            </button>
        </div>
    )
}
