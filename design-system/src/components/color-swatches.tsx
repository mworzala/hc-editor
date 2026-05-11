import { cn } from '@hollowcube/design-system/lib/utils'

type Swatch = { name: string; varName: string; foreground?: string }
type SwatchRowProps = { label: string; swatches: Swatch[] }

function SwatchRow({ label, swatches }: SwatchRowProps) {
    return (
        <div className='flex flex-col gap-2'>
            <div className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                {label}
            </div>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4'>
                {swatches.map((s) => (
                    <div
                        key={s.varName}
                        className='flex flex-col gap-2 rounded-lg border bg-card p-3'
                    >
                        <div
                            className={cn('h-12 w-full rounded-md ring-1 ring-border/40')}
                            style={{ background: `var(${s.varName})` }}
                        />
                        <div className='flex flex-col gap-0.5'>
                            <div className='text-xs font-medium'>{s.name}</div>
                            <code className='text-muted-foreground text-[10px]'>{s.varName}</code>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

const BACKGROUND_SWATCHES: Swatch[] = [
    { name: 'background', varName: '--background' },
    { name: 'foreground', varName: '--foreground' },
    { name: 'card', varName: '--card' },
    { name: 'card-foreground', varName: '--card-foreground' },
    { name: 'popover', varName: '--popover' },
    { name: 'popover-foreground', varName: '--popover-foreground' },
    { name: 'muted', varName: '--muted' },
    { name: 'muted-foreground', varName: '--muted-foreground' },
]

const PRIMARY_SWATCHES: Swatch[] = [
    { name: 'primary', varName: '--primary' },
    { name: 'primary-foreground', varName: '--primary-foreground' },
    { name: 'accent', varName: '--accent' },
    { name: 'accent-foreground', varName: '--accent-foreground' },
]

const SECONDARY_SWATCHES: Swatch[] = [
    { name: 'secondary', varName: '--secondary' },
    { name: 'secondary-foreground', varName: '--secondary-foreground' },
    { name: 'destructive', varName: '--destructive' },
    { name: 'border', varName: '--border' },
    { name: 'input', varName: '--input' },
    { name: 'ring', varName: '--ring' },
]

function ColorSwatches() {
    return (
        <div className='flex flex-col gap-6'>
            <SwatchRow label='Background scale' swatches={BACKGROUND_SWATCHES} />
            <SwatchRow label='Primary / accent' swatches={PRIMARY_SWATCHES} />
            <SwatchRow label='Secondary / surfaces' swatches={SECONDARY_SWATCHES} />
        </div>
    )
}

export { ColorSwatches, SwatchRow }
