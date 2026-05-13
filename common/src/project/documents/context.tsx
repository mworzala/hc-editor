import { createContext, useContext, useRef, type ReactNode } from 'react'

import {
    createDocumentStore,
    selectDirtyDocuments,
    type Document,
    type DocumentId,
    type DocumentStore,
} from './store'

const DocumentStoreContext = createContext<DocumentStore | null>(null)

export function DocumentStoreProvider({ children }: { children: ReactNode }) {
    const ref = useRef<DocumentStore | null>(null)
    if (!ref.current) ref.current = createDocumentStore()
    return (
        <DocumentStoreContext.Provider value={ref.current}>
            {children}
        </DocumentStoreContext.Provider>
    )
}

export function useDocumentStore(): DocumentStore {
    const store = useContext(DocumentStoreContext)
    if (!store) {
        throw new Error('useDocumentStore must be used inside <DocumentStoreProvider>')
    }
    return store
}

/** Subscribe to a single document. Returns `undefined` if no tab has opened it. */
export function useDocument(id: DocumentId): Document | undefined {
    const useStore = useDocumentStore()
    return useStore((s) => s.documents[id])
}

/** Returns the list of dirty documents. Updates when any doc's dirty state flips. */
export function useDirtyDocuments(): Document[] {
    const useStore = useDocumentStore()
    return useStore(selectDirtyDocuments)
}
