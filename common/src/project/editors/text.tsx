import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'

import {
    useV1ProjectFilesGet,
    useV1ProjectFilesUpdate,
    type ProjectFileBytes,
} from '@hollowcube/api'
import { Button, Input, Label } from '@hollowcube/design-system'

import { CodeEditor, type CodeEditorApi, type UsageMatch } from '../../editor'
import { useLanguageForMime } from '../../editor/languages'
import {
    fileUriFromPath,
    lspExtensions,
    LUAU_LANGUAGE_ID,
    resolveUri,
    runGotoDefinitionAtPos,
    useDiagnosticCounts,
    useLuauLsp,
    type DiagnosticCounts,
    type ReferenceMatch,
    type ResolvedUri,
} from '../../lsp'
import { type Tab, useWorkspaceContext } from '../../workspace'
import { useProjectActions } from '../actions'
import { useProject } from '../context'
import { usePendingFile, usePendingFilesStore } from '../data/pending-files'
import { useDocument, useDocumentStore } from '../documents'
import { renderFileIcon } from '../file-icons'
import { type EditorDefinition } from '../registry'
import { DOCS_EDITOR_KIND } from './docs'

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

/** Inclusive 1-indexed line + 0-indexed column ranges, captured at the LSP
 *  layer (line/character tuples) before we know the target document's
 *  contents. The text editor converts these to offsets after the document
 *  loads. */
export type FlashLspRange = {
    startLine: number
    startCharacter: number
    endLine: number
    endCharacter: number
}

export type TextEditorPayload = {
    path?: string
    tempId?: string
    /** One-shot: when set, the editor scrolls to this line on mount, then
     *  clears the field so subsequent activations don't re-scroll. Set by the
     *  search popup's text-search result invocation. */
    scrollToLine?: number
    /** One-shot: when set, the editor flashes this range on mount. Used by
     *  cross-file go-to-definition so the user sees where they landed.
     *  Scrubbed after first use. */
    flashLspRange?: FlashLspRange
}

function parseTextPayload(raw: unknown): TextEditorPayload {
    if (!raw || typeof raw !== 'object') return {}
    const obj = raw as Record<string, unknown>
    const out: TextEditorPayload = {}
    if (typeof obj.path === 'string') out.path = obj.path
    if (typeof obj.tempId === 'string') out.tempId = obj.tempId
    if (typeof obj.scrollToLine === 'number') out.scrollToLine = obj.scrollToLine
    if (
        obj.flashLspRange &&
        typeof obj.flashLspRange === 'object' &&
        typeof (obj.flashLspRange as FlashLspRange).startLine === 'number' &&
        typeof (obj.flashLspRange as FlashLspRange).startCharacter === 'number' &&
        typeof (obj.flashLspRange as FlashLspRange).endLine === 'number' &&
        typeof (obj.flashLspRange as FlashLspRange).endCharacter === 'number'
    ) {
        out.flashLspRange = obj.flashLspRange as FlashLspRange
    }
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

/** Convert an LSP `{ line, character }` (UTF-16 code units, 0-indexed) to a
 *  document offset in `text`. Clamps out-of-range positions to the nearest
 *  valid offset so a stale flash hint can't crash the editor. */
function lspPosToOffset(text: string, line: number, character: number): number {
    if (line < 0) return 0
    let offset = 0
    let currentLine = 0
    while (currentLine < line) {
        const nl = text.indexOf('\n', offset)
        if (nl === -1) return text.length
        offset = nl + 1
        currentLine++
    }
    const nextNl = text.indexOf('\n', offset)
    const lineEnd = nextNl === -1 ? text.length : nextNl
    return Math.min(offset + Math.max(0, character), lineEnd)
}

// Stored as the unknown-payload variant so it can live in the registry's
// `AnyEditorDefinition[]` array. Casts at the boundary are safe because
// `parsePayload` narrows everything that flows through.
export const textEditor: EditorDefinition = {
    kind: TEXT_EDITOR_KIND,
    mimeTypes: ['text/*', 'application/json', 'application/luau', 'text/x-luau'],
    parsePayload: (raw) => parseTextPayload(raw),
    titleFor: (payload) => titleFor(payload as TextEditorPayload),
    iconFor: (payload) => {
        const p = payload as TextEditorPayload
        return renderFileIcon(p.path ?? '')
    },
    render: ({ tab, payload }) => <TextTab tab={tab} payload={payload as TextEditorPayload} />,
}

function TextTab({ tab, payload }: { tab: Tab; payload: TextEditorPayload }) {
    const project = useProject()
    const { useStore } = useWorkspaceContext()
    const documentStore = useDocumentStore()
    const pendingStore = usePendingFilesStore()
    const updateMutation = useV1ProjectFilesUpdate()
    const luauLsp = useLuauLsp()
    const { openEditor } = useProjectActions()
    const editorApiRef = useRef<CodeEditorApi | null>(null)

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

    // Resolve the language. Prefer the path-based mime when the server's
    // content-type is too coarse (text/plain) to pick a specific language —
    // backends often return text/plain for `.luau` since there's no standard
    // mime for it. Pending files have no server content-type, so the path
    // fallback is the only signal.
    const mimeFromServer = fileQuery.data?.contentType
    const mimeFromPath = effectivePath ? mimeFromExtension(effectivePath) : undefined
    const resolvedMime =
        mimeFromPath && (!mimeFromServer || mimeFromServer === 'text/plain')
            ? mimeFromPath
            : (mimeFromServer ?? mimeFromPath)
    const language = useLanguageForMime(resolvedMime)

    // Extra extensions: when the file is Luau and the LSP is running, fold in
    // the LSP-driven feature set keyed on the file's URI. didOpen/didChange/
    // didClose are owned by LspBufferBridge — we only inject the read-side
    // extensions here.
    const knownPaths = useMemo(() => project.files.map((f) => f.path), [project.files])
    const luauLspActive =
        language?.id === LUAU_LANGUAGE_ID &&
        !!luauLsp.client &&
        luauLsp.status === 'running' &&
        !!effectivePath

    const definitionOpenHandler = useCallback(
        (resolved: ResolvedUri, targetRange?: { start: { line: number; character: number }; end: { line: number; character: number } }) => {
            if (resolved.kind === 'file') {
                const payload: Record<string, unknown> = { path: resolved.path }
                if (targetRange) {
                    payload.flashLspRange = {
                        startLine: targetRange.start.line,
                        startCharacter: targetRange.start.character,
                        endLine: targetRange.end.line,
                        endCharacter: targetRange.end.character,
                    }
                }
                openEditor({
                    kind: TEXT_EDITOR_KIND,
                    payload,
                    identityKey: 'path',
                })
            } else if (resolved.kind === 'doc-module') {
                openEditor({
                    kind: DOCS_EDITOR_KIND,
                    payload: { moduleId: resolved.module.alias, kind: 'library' },
                    identityKey: 'moduleId',
                })
            } else if (resolved.kind === 'definition-file') {
                openEditor({
                    kind: DOCS_EDITOR_KIND,
                    payload: { moduleId: resolved.file.alias, kind: 'definition-file' },
                    identityKey: 'moduleId',
                })
            }
        },
        [openEditor],
    )

    const resolveTargetUri = useCallback(
        (targetUri: string) => resolveUri(targetUri, knownPaths),
        [knownPaths],
    )

    // Bridge LSP-supplied references into CodeEditor's existing find-usages
    // popup. Fired when the user cmd-clicks a symbol's declaration —
    // JetBrains-style "click-on-the-declaration shows usages" behavior.
    const showReferences = useCallback(
        (
            matches: ReferenceMatch[],
            anchorPos: number,
            sourceRange: { from: number; to: number },
        ) => {
            const api = editorApiRef.current
            if (!api) return
            const usageMatches: UsageMatch[] = matches.map((m) => ({
                line: m.line,
                col: m.col,
                from: m.from,
                to: m.to,
                snippet: m.snippet,
            }))
            // Title prefers the clicked source text so the popup header reads
            // like a real symbol name. Falls back to a generic label.
            const sourceText = (() => {
                const doc = documentStore.getState().documents[docId]
                if (!doc) return 'symbol'
                return doc.current.slice(sourceRange.from, sourceRange.to) || 'symbol'
            })()
            api.showUsages(sourceText, usageMatches, anchorPos, sourceRange)
        },
        [docId, documentStore],
    )

    const extraExtensions = useMemo(() => {
        if (!luauLspActive || !effectivePath || !luauLsp.client) return undefined
        const uri = fileUriFromPath(effectivePath)
        return lspExtensions({
            client: luauLsp.client,
            uri,
            resolve: resolveTargetUri,
            onDefinitionOpen: definitionOpenHandler,
            onShowReferences: showReferences,
        })
    }, [
        luauLspActive,
        effectivePath,
        luauLsp.client,
        resolveTargetUri,
        definitionOpenHandler,
        showReferences,
    ])

    // Allow the right-click "Go to definition" action to dispatch through
    // the same LSP machinery cmd+click uses. Passes `showReferences` so the
    // click-on-the-declaration case surfaces usages instead of a no-op cursor
    // move.
    const goToDefinitionAt = useMemo(() => {
        if (!luauLspActive || !effectivePath || !luauLsp.client) return undefined
        const client = luauLsp.client
        const uri = fileUriFromPath(effectivePath)
        return (pos: number, view: import('@codemirror/view').EditorView) => {
            void runGotoDefinitionAtPos(
                view,
                client,
                uri,
                pos,
                resolveTargetUri,
                definitionOpenHandler,
                showReferences,
            )
        }
    }, [
        luauLspActive,
        effectivePath,
        luauLsp.client,
        resolveTargetUri,
        definitionOpenHandler,
        showReferences,
    ])

    // Diagnostic counts for the badge in the editor pane's top-right.
    const diagnosticUri = luauLspActive && effectivePath ? fileUriFromPath(effectivePath) : null
    const diagnosticCounts = useDiagnosticCounts(luauLsp.client, diagnosticUri)

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

    // Honor scrollToLine + flashLspRange on first mount of the tab — once
    // we've taken the hint, scrub them from the persisted payload so
    // re-activations of the same tab don't keep jumping or re-flashing.
    // We re-latch them whenever the payload reference changes too, so a
    // re-activation of an existing tab with a fresh hint (e.g. another
    // cross-file go-to-def to the same file) picks them up.
    const initialScrollToLine = payload.scrollToLine
    const initialFlashLspRange = payload.flashLspRange
    useEffect(() => {
        if (initialScrollToLine === undefined && initialFlashLspRange === undefined) return
        useStore.getState().updateTab(tab.id, {
            payload: { path: payload.path, tempId: payload.tempId },
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: scrub on each new hint
    }, [initialScrollToLine, initialFlashLspRange])

    // Convert the LSP-coord flash range to document offsets once the
    // document is loaded. A fresh object identity makes CodeEditor's flash
    // effect re-fire when the user jumps here again.
    const flashRange = useMemo(() => {
        if (!initialFlashLspRange) return undefined
        const text = doc?.current
        if (text === undefined) return undefined
        const r = initialFlashLspRange
        const from = lspPosToOffset(text, r.startLine, r.startCharacter)
        const to = lspPosToOffset(text, r.endLine, r.endCharacter)
        if (to <= from) return undefined
        return { from, to }
    }, [initialFlashLspRange, doc?.current])

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
            <div className='relative min-h-0 flex-1'>
                <CodeEditor
                    value={doc.current}
                    onChange={setContent}
                    language={language}
                    extraExtensions={extraExtensions}
                    onGoToDefinitionAt={goToDefinitionAt}
                    suppressCmdClickUsages={luauLspActive}
                    suppressFoldGutter={luauLspActive}
                    apiRef={editorApiRef}
                    scrollToLine={initialScrollToLine}
                    flashRange={flashRange}
                    onBlur={() => {
                        if (effectivePath) void save()
                    }}
                />
                {luauLspActive && diagnosticCounts.total > 0 ? (
                    <DiagnosticBadge counts={diagnosticCounts} />
                ) : null}
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

function DiagnosticBadge({ counts }: { counts: DiagnosticCounts }) {
    return (
        <div
            className='border-border bg-popover text-popover-foreground pointer-events-none absolute right-3 top-2 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[0.7rem] font-medium shadow-sm'
            role='status'
            aria-label={`${counts.total} diagnostics in this file`}
        >
            {counts.errors > 0 ? (
                <span className='flex items-center gap-1'>
                    <span
                        className='h-1.5 w-1.5 rounded-full'
                        style={{ background: 'var(--destructive)' }}
                    />
                    {counts.errors}
                </span>
            ) : null}
            {counts.warnings > 0 ? (
                <span className='flex items-center gap-1'>
                    <span className='h-1.5 w-1.5 rounded-full bg-yellow-300' />
                    {counts.warnings}
                </span>
            ) : null}
            {counts.infos > 0 ? (
                <span className='flex items-center gap-1'>
                    <span className='h-1.5 w-1.5 rounded-full bg-sky-300' />
                    {counts.infos}
                </span>
            ) : null}
            {counts.hints > 0 ? (
                <span className='text-muted-foreground flex items-center gap-1'>
                    <span className='h-1.5 w-1.5 rounded-full bg-current' />
                    {counts.hints}
                </span>
            ) : null}
        </div>
    )
}

// Best-effort mime sniffing from a filename. Covers the languages we register
// in the LanguageRegistry; unknown extensions return `undefined` and the
// editor falls back to plain text.
function mimeFromExtension(path: string): string | undefined {
    const dot = path.lastIndexOf('.')
    if (dot === -1) return undefined
    const ext = path.slice(dot).toLowerCase()
    switch (ext) {
        case '.json':
            return 'application/json'
        case '.luau':
        case '.lua':
            return 'application/luau'
        default:
            return undefined
    }
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
