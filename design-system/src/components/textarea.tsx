import { cn } from '@hollowcube/design-system/lib/utils'
import * as React from 'react'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
    return (
        <textarea
            data-slot='textarea'
            className={cn(
                'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/30 dark:bg-input/30 dark:disabled:bg-input/80',
                className,
            )}
            {...props}
        />
    )
}

export { Textarea }
