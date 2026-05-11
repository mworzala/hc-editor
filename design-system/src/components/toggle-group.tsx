'use client'

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { cn } from '@hollowcube/design-system/lib/utils'

function ToggleGroup({
    className,
    orientation = 'horizontal',
    ...props
}: ToggleGroupPrimitive.Props & { orientation?: 'horizontal' | 'vertical' }) {
    return (
        <ToggleGroupPrimitive
            data-slot='toggle-group'
            data-orientation={orientation}
            className={cn(
                'inline-flex w-fit flex-row flex-wrap items-center gap-1.5 data-vertical:flex-col data-vertical:items-stretch',
                className,
            )}
            {...props}
        />
    )
}

function ToggleGroupItem({ className, children, ...props }: TogglePrimitive.Props) {
    return (
        <TogglePrimitive
            data-slot='toggle-group-item'
            className={cn(
                'inline-flex h-5 shrink-0 items-center justify-center gap-1 rounded-sm border border-border bg-transparent px-1.5 py-0.5 text-[0.7rem] whitespace-nowrap text-foreground transition-colors outline-none select-none',
                'hover:border-foreground/30 hover:bg-muted/40',
                'focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30',
                'data-[pressed]:border-transparent data-[pressed]:bg-secondary data-[pressed]:text-secondary-foreground',
                'disabled:pointer-events-none disabled:opacity-50',
                "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
                className,
            )}
            {...props}
        >
            {children}
        </TogglePrimitive>
    )
}

export { ToggleGroup, ToggleGroupItem }
