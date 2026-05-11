import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@hollowcube/design-system/lib/utils'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import { type Tab } from './types'

type TabBarProps = {
    paneId: string // unique per tool dock / editor leaf — used in sortable ids
    tabs: Tab[]
    activeId: string | null
    onActivate: (id: string) => void
    onClose: (id: string) => void
}

export function TabBar({ paneId, tabs, activeId, onActivate, onClose }: TabBarProps) {
    const scrollerRef = React.useRef<HTMLDivElement | null>(null)

    // Mousewheel = horizontal scroll on the tab strip (no Shift required).
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
            className='flex w-full min-w-0 items-stretch overflow-x-auto overflow-y-hidden border-b border-border bg-surface scrollbar-thin scrollbar-track-transparent scrollbar-thumb-border'
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
                />
            ))}
            {tabs.length === 0 ? (
                <div className='text-muted-foreground px-3 py-1.5 text-[0.7rem]'>Empty</div>
            ) : null}
        </div>
    )
}

type SortableTabProps = {
    paneId: string
    tab: Tab
    active: boolean
    onActivate: (id: string) => void
    onClose: (id: string) => void
}

function SortableTab({ paneId, tab, active, onActivate, onClose }: SortableTabProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tab.id,
        data: { paneId, tabId: tab.id, kind: 'tab' as const },
    })

    return (
        <div
            ref={setNodeRef}
            style={{
                transform: CSS.Translate.toString(transform),
                transition,
            }}
            className={cn(
                'group/tab relative flex shrink-0 items-center gap-1 border-r border-border px-3 py-1 text-[0.75rem] select-none',
                'cursor-pointer',
                active
                    ? 'bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                isDragging && 'opacity-40',
            )}
            onClick={() => onActivate(tab.id)}
            {...attributes}
            {...listeners}
        >
            <span className='truncate'>{tab.title}</span>
            <button
                type='button'
                aria-label={`Close ${tab.title}`}
                className={cn(
                    'ml-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm',
                    'opacity-0 transition-opacity group-hover/tab:opacity-100 focus-visible:opacity-100',
                    'hover:bg-secondary',
                )}
                onClick={(e) => {
                    e.stopPropagation()
                    onClose(tab.id)
                }}
                onPointerDown={(e) => {
                    // Prevent sortable from grabbing the close button.
                    e.stopPropagation()
                }}
            >
                <XIcon className='size-3' />
            </button>
            {active ? (
                <span
                    aria-hidden='true'
                    className='bg-primary pointer-events-none absolute inset-x-0 bottom-0 h-0.5'
                />
            ) : null}
        </div>
    )
}
