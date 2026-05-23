import type { EngineApiBundle } from '../../engine-api/bundle'
import { useSignal } from '../foundation/react'
import { useProject } from '../foundation/react'
import type { EngineApiStatus } from './EngineApiService'

export function useEngineApiService() {
    return useProject().engineApi
}

export function useEngineApiStatus(): EngineApiStatus {
    return useSignal(useProject().engineApi.status)
}

export function useEngineApiBundle(): EngineApiBundle | null {
    return useSignal(useProject().engineApi.bundle)
}

/** Legacy shape — preserves the field surface of the old
 *  `useEngineApi()` hook so existing consumers compile. Maps the model
 *  status into the discriminated union the old `<EngineApiProvider>`
 *  emitted. */
export type EngineApiState =
    | { status: 'loading'; bundle: null; error: null }
    | { status: 'ready'; bundle: EngineApiBundle; error: null }
    | { status: 'error'; bundle: null; error: Error }

export function useEngineApi(): EngineApiState {
    const status = useEngineApiStatus()
    if (status.kind === 'ready') return { status: 'ready', bundle: status.bundle, error: null }
    if (status.kind === 'error') {
        const e = status.error instanceof Error ? status.error : new Error(String(status.error))
        return { status: 'error', bundle: null, error: e }
    }
    return { status: 'loading', bundle: null, error: null }
}
