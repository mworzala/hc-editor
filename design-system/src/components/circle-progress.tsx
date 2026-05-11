import { cn } from '@hollowcube/design-system/lib/utils'
import * as React from 'react'

type CircleProgressProps = React.HTMLAttributes<HTMLDivElement> & {
    value: number
    max?: number
    size?: number
    strokeWidth?: number
    label?: React.ReactNode
    showValue?: boolean
}

function CircleProgress({
    value,
    max = 100,
    size = 56,
    strokeWidth = 5,
    label,
    showValue = true,
    className,
    ...props
}: CircleProgressProps) {
    const pct = Math.max(0, Math.min(1, value / max))
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    const dash = circumference * pct

    return (
        <div
            data-slot='circle-progress'
            role='progressbar'
            aria-valuenow={Math.round(value)}
            aria-valuemin={0}
            aria-valuemax={max}
            className={cn('relative inline-flex items-center justify-center', className)}
            style={{ width: size, height: size }}
            {...props}
        >
            <svg width={size} height={size} className='-rotate-90'>
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke='currentColor'
                    strokeWidth={strokeWidth}
                    fill='none'
                    className='text-muted/40'
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    stroke='currentColor'
                    strokeWidth={strokeWidth}
                    strokeLinecap='round'
                    fill='none'
                    strokeDasharray={`${dash} ${circumference}`}
                    className='text-primary transition-[stroke-dasharray] duration-300'
                />
            </svg>
            <div className='absolute inset-0 flex flex-col items-center justify-center text-xs font-medium tabular-nums'>
                {showValue ? <span>{Math.round(pct * 100)}%</span> : null}
                {label ? (
                    <span className='text-muted-foreground text-[0.625rem]'>{label}</span>
                ) : null}
            </div>
        </div>
    )
}

export { CircleProgress }
