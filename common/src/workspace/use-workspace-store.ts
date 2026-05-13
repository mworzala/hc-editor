import { useRef } from 'react'
import { type StoreApi, type UseBoundStore } from 'zustand'

import { usePlatform } from '@hollowcube/common/platform'

import { createWorkspaceStore, type WorkspaceStore } from './store'
import { type Tab, type WorkspaceState } from './types'

type Opts = {
    storageKey: string
    initialState: WorkspaceState
    /** Forwarded to `createWorkspaceStore`. The latest function is mirrored via
     *  a ref so callers can pass a fresh closure each render without
     *  rebuilding the store. */
    beforeCloseTab?: (
        tab: Tab,
        loc:
            | { kind: 'tool'; dock: 'left' | 'right' | 'bottom' }
            | { kind: 'editor'; leafId: string },
    ) => boolean | Promise<boolean>
}

/** React hook that creates a workspace store on first render, wiring it to the
 *  platform's Storage impl. Subsequent renders return the same hook. */
export function useWorkspaceStore(opts: Opts): UseBoundStore<StoreApi<WorkspaceStore>> {
    const { storage } = usePlatform()
    const beforeCloseRef = useRef(opts.beforeCloseTab)
    beforeCloseRef.current = opts.beforeCloseTab
    const ref = useRef<UseBoundStore<StoreApi<WorkspaceStore>> | null>(null)
    if (!ref.current) {
        ref.current = createWorkspaceStore({
            storageKey: opts.storageKey,
            initialState: opts.initialState,
            storage,
            beforeCloseTab: (tab, loc) => beforeCloseRef.current?.(tab, loc) ?? true,
        })
    }
    return ref.current
}
