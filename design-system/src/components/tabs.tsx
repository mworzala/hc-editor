'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@hollowcube/design-system/lib/utils'

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
    return (
        <TabsPrimitive.Root
            data-slot='tabs'
            data-orientation={orientation}
            className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
            {...props}
        />
    )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
    return (
        <TabsPrimitive.List
            data-slot='tabs-list'
            className={cn(
                'inline-flex w-fit items-center justify-center gap-1 group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch',
                className,
            )}
            {...props}
        />
    )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
    return (
        <TabsPrimitive.Tab
            data-slot='tabs-trigger'
            className={cn(
                'inline-flex h-7 items-center justify-center gap-1.5 rounded-md border border-transparent bg-transparent px-2.5 text-[0.8rem] whitespace-nowrap text-foreground/60 transition-colors outline-none select-none',
                'hover:text-foreground',
                'focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30',
                'data-active:bg-secondary data-active:text-secondary-foreground',
                'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
                'group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start',
                "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
                className,
            )}
            {...props}
        />
    )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
    return (
        <TabsPrimitive.Panel
            data-slot='tabs-content'
            className={cn('flex-1 text-sm outline-none', className)}
            {...props}
        />
    )
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
