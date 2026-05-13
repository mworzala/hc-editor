import { createContext, useContext, useMemo, useRef, type ReactNode } from 'react'
import { create, type StoreApi, type UseBoundStore } from 'zustand'

// Pending (local-only, not-yet-saved) files. Two flavors:
//
//  • `path === null` — purely untitled (Cmd+N flow). No tree entry; the
//    editor will prompt the user for a path on first save.
//
//  • `path !== null` — created from the file tree's "New File" context menu.
//    A tree placeholder shows the chosen path; the editor opens immediately,
//    and the file is PUT to the server on first save.
//
// On save, the tab is repointed from `{ tempId }` to `{ path }` (via the
// workspace store's `updateTab`), and the entry here is removed.

export type PendingFile = {
    tempId: string
    path: string | null
    /** Display title for untitled flavor (`'Untitled-1'`, …). Unused when
     *  `path` is set since the tree row + tab title come from `path`. */
    untitledTitle?: string
}

type PendingFilesState = {
    pending: Record<string, PendingFile>
    /** Monotonic counter so untitled titles increment. */
    untitledCounter: number

    addUntitled: () => string
    addAtPath: (path: string) => string
    assignPath: (tempId: string, path: string) => void
    remove: (tempId: string) => void
}

export type PendingFilesStore = UseBoundStore<StoreApi<PendingFilesState>>

function createPendingFilesStore(): PendingFilesStore {
    return create<PendingFilesState>()((set) => ({
        pending: {},
        untitledCounter: 0,

        addUntitled: () => {
            const tempId = makeTempId()
            let untitledTitle = 'Untitled'
            set((s) => {
                const n = s.untitledCounter + 1
                untitledTitle = `Untitled-${n}`
                return {
                    untitledCounter: n,
                    pending: { ...s.pending, [tempId]: { tempId, path: null, untitledTitle } },
                }
            })
            return tempId
        },

        addAtPath: (path) => {
            const tempId = makeTempId()
            set((s) => ({
                pending: { ...s.pending, [tempId]: { tempId, path } },
            }))
            return tempId
        },

        assignPath: (tempId, path) => {
            set((s) => {
                const existing = s.pending[tempId]
                if (!existing) return s
                return { pending: { ...s.pending, [tempId]: { ...existing, path } } }
            })
        },

        remove: (tempId) => {
            set((s) => {
                if (!s.pending[tempId]) return s
                const { [tempId]: _gone, ...rest } = s.pending
                return { pending: rest }
            })
        },
    }))
}

function makeTempId(): string {
    return `pending-${crypto.randomUUID()}`
}

const PendingFilesContext = createContext<PendingFilesStore | null>(null)

export function PendingFilesProvider({ children }: { children: ReactNode }) {
    const ref = useRef<PendingFilesStore | null>(null)
    if (!ref.current) ref.current = createPendingFilesStore()
    return (
        <PendingFilesContext.Provider value={ref.current}>{children}</PendingFilesContext.Provider>
    )
}

export function usePendingFilesStore(): PendingFilesStore {
    const store = useContext(PendingFilesContext)
    if (!store) {
        throw new Error('usePendingFilesStore must be used inside <PendingFilesProvider>')
    }
    return store
}

/** Subscribe to a single pending entry. Returns `undefined` if not present. */
export function usePendingFile(tempId: string | undefined): PendingFile | undefined {
    const useStore = usePendingFilesStore()
    return useStore((s) => (tempId ? s.pending[tempId] : undefined))
}

/** Subscribe to the full list of pending entries. Returns a sorted array, but
 *  selects the underlying map by reference so React's getSnapshot stays
 *  stable when nothing has changed. */
export function usePendingFiles(): PendingFile[] {
    const useStore = usePendingFilesStore()
    const pending = useStore((s) => s.pending)
    return useMemo(() => {
        const entries = Object.values(pending)
        entries.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''))
        return entries
    }, [pending])
}
