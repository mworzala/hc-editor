import { useRef } from 'react'
import { type StoreApi, type UseBoundStore } from 'zustand'

import { usePlatform } from '@hollowcube/common/platform'

import { createWorkspaceStore, type WorkspaceStore } from './store'
import { type WorkspaceState } from './types'

type Opts = {
    storageKey: string
    initialState: WorkspaceState
}

/** React hook that creates a workspace store on first render, wiring it to the
 *  platform's Storage impl. Subsequent renders return the same hook. */
export function useWorkspaceStore(opts: Opts): UseBoundStore<StoreApi<WorkspaceStore>> {
    const { storage } = usePlatform()
    const ref = useRef<UseBoundStore<StoreApi<WorkspaceStore>> | null>(null)
    if (!ref.current) {
        ref.current = createWorkspaceStore({
            storageKey: opts.storageKey,
            initialState: opts.initialState,
            storage,
        })
    }
    return ref.current
}
