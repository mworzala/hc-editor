import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cn } from '@hollowcube/design-system/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'

const buttonVariants = cva(
    "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding leading-none whitespace-nowrap transition-all outline-none select-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground hover:bg-primary/90',
                outline:
                    'border-border bg-transparent text-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted',
                secondary:
                    'bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary',
                ghost: 'hover:bg-muted hover:text-foreground aria-expanded:bg-muted',
                destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
                success: 'bg-success text-success-foreground hover:bg-success/90',
                warning: 'bg-warning text-warning-foreground hover:bg-warning/90',
                link: 'text-primary underline-offset-4 hover:underline',
            },
            size: {
                default:
                    "h-7 gap-1 px-2 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
                xs: "h-5 gap-1 px-1.5 text-[0.7rem] has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
                sm: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
                lg: "h-8 gap-1.5 px-2.5 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
                icon: 'size-7',
                'icon-xs': "size-5 [&_svg:not([class*='size-'])]:size-3",
                'icon-sm': "size-6 [&_svg:not([class*='size-'])]:size-3",
                'icon-lg': "size-8 [&_svg:not([class*='size-'])]:size-4",
            },
        },
        defaultVariants: {
            variant: 'default',
            size: 'default',
        },
    },
)

function Button({
    className,
    variant = 'default',
    size = 'default',
    ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
    return (
        <ButtonPrimitive
            data-slot='button'
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    )
}

export { Button, buttonVariants }
