import { useSignal } from '../foundation/react'
import { useProject } from '../foundation/react'
import type { ConnectionStatus } from './ServerEventsConnection'

export type ProjectConnection = {
    status: ConnectionStatus
    lastEventId: string | null
    lastEventAt: number | null
    error: unknown | null
    retry: () => void
}

export function useEvents() {
    return useProject().events
}

export function useProjectConnection(): ProjectConnection {
    const events = useProject().events
    const status = useSignal(events.status)
    const lastEventId = useSignal(events.lastEventId)
    const lastEventAt = useSignal(events.lastEventAt)
    const error = useSignal(events.error)
    return {
        status,
        lastEventId,
        lastEventAt,
        error,
        retry: () => events.retry(),
    }
}
