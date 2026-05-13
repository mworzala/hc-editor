import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import {
    useV1ProjectFilesGet,
    useV1ProjectFilesUpdate,
    type ProjectFileBytes,
} from '@hollowcube/api'
import { Button, Input, Label } from '@hollowcube/design-system'

import { CodeEditor } from '../../editor/CodeEditor'
import { type Tab, useWorkspaceContext } from '../../workspace'
import { useProject } from '../context'
import { usePendingFile, usePendingFilesStore } from '../data/pending-files'
import { useDocument, useDocumentStore } from '../documents'
import { type EditorDefinition } from '../registry'

// Generic plain-text editor. Handles two payload shapes:
//
//   • `{ path }`       — an existing or pending-with-path project file. Bytes
//                        are fetched via `useV1ProjectFilesGet`, decoded as
//                        UTF-8, and pushed into a Document keyed by the path.
//   • `{ tempId }`     — a purely untitled file (Cmd+N). No fetch; the
//                        Document starts empty. Saving prompts for a path.
//
// Save triggers: editor blur, Ctrl/Cmd+S, and the workspace store's
// `beforeCloseTab` hook (wired in ProjectWorkspace).

export const TEXT_EDITOR_KIND = 'editor:text'

export type TextEditorPayload = { path?: string; tempId?: string }

function parseTextPayload(raw: unknown): TextEditorPayload {
    if (!raw || typeof raw !== 'object') return {}
    const obj = raw as Record<string, unknown>
    const out: TextEditorPayload = {}
    if (typeof obj.path === 'string') out.path = obj.path
    if (typeof obj.tempId === 'string') out.tempId = obj.tempId
    return out
}

function titleFor(payload: TextEditorPayload): string {
    if (payload.path) return basename(payload.path)
    return 'Untitled'
}

function basename(path: string): string {
    const i = path.lastIndexOf('/')
    return i === -1 ? path : path.slice(i + 1)
}

// Stored as the unknown-payload variant so it can live in the registry's
// `AnyEditorDefinition[]` array. Casts at the boundary are safe because
// `parsePayload` narrows everything that flows through.
export const textEditor: EditorDefinition = {
    kind: TEXT_EDITOR_KIND,
    mimeTypes: ['text/*', 'application/json'],
    parsePayload: (raw) => parseTextPayload(raw),
    titleFor: (payload) => titleFor(payload as TextEditorPayload),
    render: ({ tab, payload }) => <TextTab tab={tab} payload={payload as TextEditorPayload} />,
}

function TextTab({ tab, payload }: { tab: Tab; payload: TextEditorPayload }) {
    const project = useProject()
    const { useStore } = useWorkspaceContext()
    const documentStore = useDocumentStore()
    const pendingStore = usePendingFilesStore()
    const updateMutation = useV1ProjectFilesUpdate()

    // Resolve the effective path: explicit `path` wins; otherwise look up the
    // pending entry which may have a path (right-click new) or none (untitled).
    const pending = usePendingFile(payload.tempId)
    const effectivePath = payload.path ?? pending?.path ?? null

    const docId = useMemo(() => {
        if (effectivePath) return effectivePath
        if (payload.tempId) return `unsaved:${payload.tempId}`
        return `unsaved:${tab.id}`
    }, [effectivePath, payload.tempId, tab.id])

    const fileQuery = useV1ProjectFilesGet(project.id, effectivePath ?? '', {
        enabled: effectivePath !== null && !payload.tempId,
        retry: 0,
    })

    const doc = useDocument(docId)

    // Open / close the document on mount / unmount. The document store
    // refcounts so multiple tabs of the same file share a single buffer.
    const initialContent = useMemo(() => {
        if (!effectivePath || !fileQuery.data) return ''
        return decodeText(fileQuery.data)
    }, [effectivePath, fileQuery.data])

    const openedRef = useRef(false)
    useEffect(() => {
        if (openedRef.current) return
        if (effectivePath && !fileQuery.data) return
        documentStore.getState().openDocument(docId, initialContent)
        openedRef.current = true
    }, [docId, documentStore, effectivePath, fileQuery.data, initialContent])

    useEffect(() => {
        return () => {
            if (openedRef.current) documentStore.getState().closeDocument(docId)
            openedRef.current = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId])

    // If the server pushes a new clean snapshot (event-driven refetch), update
    // the document's `original` and `current` so the editor sees the new text.
    // We only do this when the doc is clean — dirty buffers are left alone.
    useEffect(() => {
        if (!effectivePath || !fileQuery.data) return
        const state = documentStore.getState()
        const current = state.documents[docId]
        if (!current) return
        const incoming = decodeText(fileQuery.data)
        if (current.current === incoming && current.original === incoming) return
        if (current.dirty) return
        // Re-open is idempotent on existing docs; we instead set+commit so the
        // refcount stays stable.
        state.setContent(docId, incoming)
        state.commit(docId)
    }, [docId, documentStore, effectivePath, fileQuery.data])

    const setContent = useCallback(
        (next: string) => {
            documentStore.getState().setContent(docId, next)
        },
        [docId, documentStore],
    )

    const [savePromptOpen, setSavePromptOpen] = useState(false)
    const [saveError, setSaveError] = useState<unknown>(null)

    const saveAtPath = useCallback(
        async (path: string) => {
            const body = documentStore.getState().documents[docId]?.current ?? ''
            try {
                await updateMutation.mutateAsync({
                    projectId: project.id,
                    path,
                    body,
                    contentType: 'text/plain',
                })
                const store = documentStore.getState()
                if (path !== docId) {
                    // Promote the unsaved document to its real id (the path).
                    store.openDocument(path, body)
                    store.commit(path)
                    store.closeDocument(docId, { force: true })
                } else {
                    store.commit(docId)
                }
                if (payload.tempId) pendingStore.getState().remove(payload.tempId)
                // Patch the tab: drop tempId, point at path.
                useStore.getState().updateTab(tab.id, {
                    title: basename(path),
                    payload: { path },
                })
                setSaveError(null)
                return true
            } catch (e) {
                setSaveError(e)
                return false
            }
        },
        [
            docId,
            documentStore,
            payload.tempId,
            pendingStore,
            project.id,
            tab.id,
            updateMutation,
            useStore,
        ],
    )

    const save = useCallback(async (): Promise<boolean> => {
        const current = documentStore.getState().documents[docId]
        if (!current || !current.dirty) return true
        if (effectivePath) {
            return saveAtPath(effectivePath)
        }
        setSavePromptOpen(true)
        return false
    }, [docId, documentStore, effectivePath, saveAtPath])

    // Cmd/Ctrl+S — local to the editor pane so it only fires when the user is
    // working in this tab.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                e.preventDefault()
                void save()
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [save])

    if (effectivePath && fileQuery.isPending) {
        return <Status>Loading {basename(effectivePath)}…</Status>
    }
    if (effectivePath && fileQuery.error) {
        return <Status tone='error'>Failed to load: {String(fileQuery.error)}</Status>
    }
    if (!doc) {
        return <Status>Preparing editor…</Status>
    }

    return (
        <div className='relative flex h-full flex-col'>
            <div className='min-h-0 flex-1'>
                <CodeEditor
                    value={doc.current}
                    onChange={setContent}
                    onBlur={() => {
                        if (effectivePath) void save()
                    }}
                />
            </div>
            {saveError ? (
                <div className='border-destructive/40 bg-destructive/10 text-destructive m-2 rounded-sm border px-2 py-1 text-xs'>
                    Save failed: {formatError(saveError)}
                </div>
            ) : null}
            {savePromptOpen ? (
                <SavePathPrompt
                    suggested={pending?.untitledTitle ?? 'untitled.txt'}
                    onCancel={() => setSavePromptOpen(false)}
                    onConfirm={async (path) => {
                        const ok = await saveAtPath(path)
                        if (ok) setSavePromptOpen(false)
                    }}
                />
            ) : null}
        </div>
    )
}

function decodeText(bytes: ProjectFileBytes): string {
    try {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes.bytes)
    } catch {
        return ''
    }
}

function Status({ children, tone }: { children: ReactNode; tone?: 'error' }) {
    return (
        <div
            className={
                tone === 'error'
                    ? 'text-destructive flex h-full items-center justify-center p-6 text-sm'
                    : 'text-muted-foreground flex h-full items-center justify-center p-6 text-sm'
            }
        >
            {children}
        </div>
    )
}

function formatError(e: unknown): string {
    if (e instanceof Error) return e.message
    return String(e)
}

function SavePathPrompt({
    suggested,
    onCancel,
    onConfirm,
}: {
    suggested: string
    onCancel: () => void
    onConfirm: (path: string) => void
}) {
    const [value, setValue] = useState(suggested)
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement | null>(null)
    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])
    return (
        <div className='border-border bg-popover absolute inset-x-4 bottom-4 flex flex-col gap-2 rounded-md border p-3 shadow-lg'>
            <Label htmlFor={inputId}>Save as</Label>
            <Input
                id={inputId}
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && value.trim()) {
                        e.preventDefault()
                        onConfirm(value.trim())
                    } else if (e.key === 'Escape') {
                        e.preventDefault()
                        onCancel()
                    }
                }}
                placeholder='path/to/file.txt'
            />
            <div className='flex justify-end gap-2'>
                <Button size='sm' variant='ghost' onClick={onCancel}>
                    Cancel
                </Button>
                <Button size='sm' disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>
                    Save
                </Button>
            </div>
        </div>
    )
}
