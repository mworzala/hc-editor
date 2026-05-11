import { Button } from '@hollowcube/design-system/components/button'
import { cn } from '@hollowcube/design-system/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import { XIcon } from 'lucide-react'
import * as React from 'react'

const bannerVariants = cva(
    'flex w-full items-start gap-3 rounded-lg border bg-clip-padding p-3 text-sm',
    {
        variants: {
            variant: {
                info: 'border-border bg-card text-foreground',
                success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
                warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
                error: 'border-destructive/30 bg-destructive/10 text-destructive',
            },
        },
        defaultVariants: {
            variant: 'info',
        },
    },
)

type BannerProps = React.HTMLAttributes<HTMLDivElement> &
    VariantProps<typeof bannerVariants> & {
        title?: React.ReactNode
        description?: React.ReactNode
        icon?: React.ReactNode
        primaryCta?: { label: string; onClick?: () => void }
        secondaryCta?: { label: string; onClick?: () => void }
        onDismiss?: () => void
    }

function Banner({
    className,
    variant,
    title,
    description,
    icon,
    primaryCta,
    secondaryCta,
    onDismiss,
    children,
    ...props
}: BannerProps) {
    return (
        <div data-slot='banner' className={cn(bannerVariants({ variant, className }))} {...props}>
            {icon ? <div className='mt-0.5 shrink-0 [&>svg]:size-4'>{icon}</div> : null}
            <div className='flex min-w-0 flex-1 flex-col gap-2'>
                <div className='flex flex-col gap-0.5'>
                    {title ? <div className='font-medium leading-tight'>{title}</div> : null}
                    {description ? (
                        <div className='text-muted-foreground text-xs leading-relaxed'>
                            {description}
                        </div>
                    ) : null}
                    {children}
                </div>
                {(primaryCta || secondaryCta) && (
                    <div className='flex flex-wrap gap-2 pt-1'>
                        {primaryCta && (
                            <Button size='sm' onClick={primaryCta.onClick}>
                                {primaryCta.label}
                            </Button>
                        )}
                        {secondaryCta && (
                            <Button size='sm' variant='ghost' onClick={secondaryCta.onClick}>
                                {secondaryCta.label}
                            </Button>
                        )}
                    </div>
                )}
            </div>
            {onDismiss ? (
                <Button
                    variant='ghost'
                    size='icon-xs'
                    className='shrink-0 text-muted-foreground'
                    onClick={onDismiss}
                    aria-label='Dismiss'
                >
                    <XIcon />
                </Button>
            ) : null}
        </div>
    )
}

export { Banner, bannerVariants }
