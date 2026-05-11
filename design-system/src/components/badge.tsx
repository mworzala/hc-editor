import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cn } from '@hollowcube/design-system/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const badgeVariants = cva(
    'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 text-[0.7rem] leading-none whitespace-nowrap transition-all focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 aria-invalid:border-destructive aria-invalid:ring-destructive/30 [&>svg]:pointer-events-none [&>svg]:size-3!',
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/90',
                secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
                destructive:
                    'bg-destructive text-destructive-foreground [a]:hover:bg-destructive/90',
                success: 'bg-success text-success-foreground [a]:hover:bg-success/90',
                warning: 'bg-warning text-warning-foreground [a]:hover:bg-warning/90',
                outline:
                    'border-border bg-transparent text-foreground [a]:hover:bg-muted [a]:hover:text-foreground',
                ghost: 'text-foreground hover:bg-muted',
                link: 'text-primary underline-offset-4 hover:underline',
            },
        },
        defaultVariants: {
            variant: 'default',
        },
    },
)

function Badge({
    className,
    variant = 'default',
    render,
    ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return useRender({
        defaultTagName: 'span',
        props: mergeProps<'span'>(
            {
                className: cn(badgeVariants({ variant }), className),
            },
            props,
        ),
        render,
        state: {
            slot: 'badge',
            variant,
        },
    })
}

export { Badge, badgeVariants }
