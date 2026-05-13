import { create, type StoreApi, type UseBoundStore } from 'zustand'

// Document store — content + dirty-state for things being edited. Lives
// out-of-band from the workspace layout store so:
//
//  • Document content is not serialized to localStorage with the layout. The
//    layout stores tab identity (file path); content is fetched lazily and
//    held in memory only.
//
//  • Multi-tab-same-file works naturally: tabs reference a document by id, and
//    edits in one editor instance reflect everywhere because they read from
//    the same Document.
//
// Each Document tracks: original (last-saved snapshot), current (live buffer),
// and a `dirty` flag derived from `original !== current`.

export type DocumentId = string

export type Document = {
    id: DocumentId
    /** Last-saved snapshot. `commit()` advances this; `discard()` resets the
     *  current value back to it. */
    original: string
    /** Live buffer. Edits write here. */
    current: string
    /** `true` when `current !== original`. Cached for cheap lookups. */
    dirty: boolean
    /** Refcount of open tabs referencing this document. When it drops to zero,
     *  `closeDocument` removes the entry. */
    refCount: number
}

type DocumentStoreState = {
    documents: Record<DocumentId, Document>

    /** Open or reuse a document. Idempotent: if the doc already exists, just
     *  bumps the refcount. `initialContent` is honored only on first open. */
    openDocument: (id: DocumentId, initialContent: string) => void
    /** Decrement refcount. If the caller passed `force: true` or the count
     *  drops to zero, the entry is removed regardless of dirty state — callers
     *  should prompt before closing dirty docs. */
    closeDocument: (id: DocumentId, opts?: { force?: boolean }) => void
    /** Replace the document's live buffer. Marks dirty if it diverges. */
    setContent: (id: DocumentId, content: string) => void
    /** Mark `current` as the new saved snapshot. Clears dirty. */
    commit: (id: DocumentId) => void
    /** Revert `current` to `original`. */
    discard: (id: DocumentId) => void
}

export type DocumentStore = UseBoundStore<StoreApi<DocumentStoreState>>

export function createDocumentStore(): DocumentStore {
    return create<DocumentStoreState>()((set) => ({
        documents: {},

        openDocument: (id, initialContent) => {
            set((s) => {
                const existing = s.documents[id]
                if (existing) {
                    return {
                        documents: {
                            ...s.documents,
                            [id]: { ...existing, refCount: existing.refCount + 1 },
                        },
                    }
                }
                const doc: Document = {
                    id,
                    original: initialContent,
                    current: initialContent,
                    dirty: false,
                    refCount: 1,
                }
                return { documents: { ...s.documents, [id]: doc } }
            })
        },

        closeDocument: (id, opts) => {
            set((s) => {
                const existing = s.documents[id]
                if (!existing) return s
                const nextCount = existing.refCount - 1
                if (nextCount > 0 && !opts?.force) {
                    return {
                        documents: {
                            ...s.documents,
                            [id]: { ...existing, refCount: nextCount },
                        },
                    }
                }
                const { [id]: _gone, ...rest } = s.documents
                return { documents: rest }
            })
        },

        setContent: (id, content) => {
            set((s) => {
                const existing = s.documents[id]
                if (!existing) return s
                return {
                    documents: {
                        ...s.documents,
                        [id]: {
                            ...existing,
                            current: content,
                            dirty: content !== existing.original,
                        },
                    },
                }
            })
        },

        commit: (id) => {
            set((s) => {
                const existing = s.documents[id]
                if (!existing) return s
                return {
                    documents: {
                        ...s.documents,
                        [id]: { ...existing, original: existing.current, dirty: false },
                    },
                }
            })
        },

        discard: (id) => {
            set((s) => {
                const existing = s.documents[id]
                if (!existing) return s
                return {
                    documents: {
                        ...s.documents,
                        [id]: { ...existing, current: existing.original, dirty: false },
                    },
                }
            })
        },
    }))
}

/** Returns the list of documents with `dirty === true`. Use this for "are
 *  there unsaved changes?" prompts (project close, window close, etc.). */
export function selectDirtyDocuments(s: { documents: Record<string, Document> }): Document[] {
    return Object.values(s.documents).filter((d) => d.dirty)
}
