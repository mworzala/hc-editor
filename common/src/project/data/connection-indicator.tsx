import { type CSSProperties, useEffect, useState } from 'react'

import {
    Button,
    cn,
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@hollowcube/design-system'

import { type ConnectionStatus, useProjectConnection } from '../../model'

// Small status dot in the project top bar. Click → popover with live details
// (status, last event id, relative "last event N seconds ago", error message,
// manual retry button).

const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties

const STATUS_LABELS: Record<ConnectionStatus, string> = {
    idle: 'Idle',
    connecting: 'Connecting…',
    connected: 'Connected',
    reconnecting: 'Reconnecting…',
    error: 'Disconnected',
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
    idle: 'bg-muted-foreground/60',
    connecting: 'bg-amber-500',
    connected: 'bg-emerald-500',
    reconnecting: 'bg-amber-500 animate-pulse',
    error: 'bg-destructive',
}

type ConnectionIndicatorProps = {
    /** Set on desktop so the button isn't eaten by the window drag region. */
    desktop?: boolean
}

export function ConnectionIndicator({ desktop }: ConnectionIndicatorProps) {
    const { status, lastEventId, lastEventAt, error, retry } = useProjectConnection()

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        variant='ghost'
                        size='icon'
                        aria-label={`Project connection: ${STATUS_LABELS[status]}`}
                        style={desktop ? noDragRegion : undefined}
                    >
                        <span className={cn('size-2 rounded-full', STATUS_DOT[status])} />
                    </Button>
                }
            />
            <PopoverContent align='end' className='w-72' style={desktop ? noDragRegion : undefined}>
                <PopoverHeader>
                    <PopoverTitle className='flex items-center gap-2'>
                        <span className={cn('size-2 rounded-full', STATUS_DOT[status])} />
                        {STATUS_LABELS[status]}
                    </PopoverTitle>
                </PopoverHeader>
                <div className='flex flex-col gap-2 text-xs'>
                    <Row label='Last event id' value={lastEventId ?? '—'} mono />
                    <Row label='Last event' value={<RelativeTime at={lastEventAt ?? undefined} />} />
                    {error ? <ErrorRow error={error} /> : null}
                </div>
                {status === 'error' ? (
                    <Button size='sm' variant='outline' onClick={retry}>
                        Reconnect
                    </Button>
                ) : null}
            </PopoverContent>
        </Popover>
    )
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
    return (
        <div className='flex items-baseline justify-between gap-2'>
            <span className='text-muted-foreground'>{label}</span>
            <span className={cn('truncate text-foreground', mono && 'font-mono')}>{value}</span>
        </div>
    )
}

function ErrorRow({ error }: { error: unknown }) {
    const message = formatError(error)
    return (
        <div className='border-destructive/40 bg-destructive/10 text-destructive rounded-sm border px-2 py-1 font-mono break-all whitespace-pre-wrap'>
            {message}
        </div>
    )
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        const status = (error as Error & { status?: number }).status
        const prefix = typeof status === 'number' ? `${status} ` : ''
        return `${prefix}${error.message}`
    }
    return String(error)
}

function RelativeTime({ at }: { at?: number }) {
    const [, force] = useState(0)
    useEffect(() => {
        if (!at) return
        const id = window.setInterval(() => force((n) => n + 1), 5_000)
        return () => window.clearInterval(id)
    }, [at])
    if (!at) return <>—</>
    const secs = Math.max(0, Math.floor((Date.now() - at) / 1000))
    if (secs < 5) return <>just now</>
    if (secs < 60) return <>{secs}s ago</>
    if (secs < 3600) return <>{Math.floor(secs / 60)}m ago</>
    return <>{Math.floor(secs / 3600)}h ago</>
}
