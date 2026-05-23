import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from 'react'
import { type EditorView } from '@codemirror/view'
import {
    AlertCircleIcon,
    AlertTriangleIcon,
    CheckIcon,
    InfoIcon,
    LightbulbIcon,
} from 'lucide-react'
import type { Diagnostic } from 'vscode-languageserver-types'

import { v1MapFilesGet, type MapFileBytes } from '@hollowcube/api'
import type { ReadonlySignal } from '@preact/signals-core'
import { Button, cn, Input, Label } from '@hollowcube/design-system'

import { CodeEditor, type CodeEditorApi, type UsageMatch } from '../../editor'
import {
    type DiagnosticCounts,
    type EditorServices,
    type LanguageEditorBinding,
} from '../../editor/languages'
import { fileUriFromPath } from '../../editor/languages/luau-editor-services'
import {
    useApp,
    useDiagnosticsForUri as modelUseDiagnosticsForUri,
    useEngineApi,
    useLanguageForMime,
    useLanguageForPath,
    useLuauLsp,
    useProject,
} from '../../model'
import { usePendingFile } from '../../model/files'
import { useSignal } from '../../model/foundation/react'
import { useLayout } from '../../model/workspace'
import { type Tab } from '../../workspace'
import { useProjectActions } from '../actions'
import { renderFileIcon } from '../file-icons'
import { type EditorDefinition } from '../registry'
import { TEXT_EDITOR_KIND } from './text-kind'

// Generic plain-text editor. Handles two payload shapes:
//
//   • `{ path }`       — an existing or pending-with-path map file. Bytes
//                        are fetched via `useV1MapFilesGet`, decoded as
//                        UTF-8, and pushed into a Document keyed by the path.
//   • `{ tempId }`     — a purely untitled file (Cmd+N). No fetch; the
//                        Document starts empty. Saving prompts for a path.
//
// Save triggers: continuous debounced autosave (path-bound tabs only),
// editor blur, and Ctrl/Cmd+S. Untitled tabs only save on explicit Ctrl/Cmd+S
// (which surfaces the save-as prompt) — autosave skips them.

// Re-export so existing `from './editors/text'` import sites keep working
// while the standalone module is the canonical source.
export { TEXT_EDITOR_KIND }

const EMPTY_EDITOR_SERVICES: EditorServices = {}

// Stable empty signals so `useSignal(...)` has a real signal to subscribe
// to before the model lands. Both peek to a falsy/empty value and never
// notify subscribers.
const EMPTY_STRING_SIGNAL = {
    get value() {
        return ''
    },
    peek: () => '',
    subscribe: () => () => {},
} as unknown as ReadonlySignal<string>
const EMPTY_BOOL_SIGNAL = {
    get value() {
        return false
    },
    peek: () => false,
    subscribe: () => () => {},
} as unknown as ReadonlySignal<boolean>

const EMPTY_DIAGNOSTIC_COUNTS: DiagnosticCounts = {
    errors: 0,
    warnings: 0,
    infos: 0,
    hints: 0,
    total: 0,
}

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

export function parseTextPayload(raw: unknown): TextEditorPayload {
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
export function lspPosToOffset(text: string, line: number, character: number): number {
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
    // Self-description for "what kinds of content does this editor render".
    // Concrete language-by-path resolution happens inside the component via
    // the language registry — no need to enumerate language mimes here.
    mimeTypes: ['text/*'],
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
    const { client: hcClient } = useApp()
    const layout = useLayout()
    const textModels = project.textModels
    const fileTreeFiles = useSignal(project.fileTree.files)
    const { openEditor } = useProjectActions()
    const editorApiRef = useRef<CodeEditorApi | null>(null)

    // Resolve the effective path: explicit `path` wins; otherwise look up the
    // pending entry which may have a path (right-click new) or none (untitled).
    const pending = usePendingFile(payload.tempId)
    const effectivePath = payload.path ?? pending?.path ?? null

    // Pending (tempId) files live entirely client-side until first save — even
    // when they have a chosen `pending.path`, the path does not yet exist on
    // the server, so we must not fetch and must not gate the editor on a fetch
    // result.
    const isExistingFile = effectivePath !== null && !payload.tempId

    const docId = useMemo(() => {
        if (effectivePath) return effectivePath
        if (payload.tempId) return `unsaved:${payload.tempId}`
        return `unsaved:${tab.id}`
    }, [effectivePath, payload.tempId, tab.id])

    // Fetch the initial bytes for existing files; pending docs start empty.
    type FetchState =
        | { kind: 'idle' }
        | { kind: 'loading' }
        | { kind: 'loaded'; bytes: MapFileBytes }
        | { kind: 'error'; error: unknown }
    const [fileFetch, setFileFetch] = useState<FetchState>(() =>
        isExistingFile ? { kind: 'loading' } : { kind: 'idle' },
    )
    useEffect(() => {
        if (!isExistingFile || !effectivePath) {
            setFileFetch({ kind: 'idle' })
            return
        }
        const ac = new AbortController()
        setFileFetch({ kind: 'loading' })
        void v1MapFilesGet(hcClient, project.projectId, effectivePath, {
            signal: ac.signal,
        }).then(
            (bytes) => {
                if (!ac.signal.aborted) setFileFetch({ kind: 'loaded', bytes })
                return undefined
            },
            (error: unknown) => {
                if (!ac.signal.aborted) setFileFetch({ kind: 'error', error })
                return undefined
            },
        )
        return () => ac.abort()
    }, [hcClient, isExistingFile, effectivePath, project.projectId])

    // Resolve the language. Prefer the path-based lookup because the server's
    // content-type is often too coarse (text/plain for `.luau` since there's no
    // standard mime). Fall back to the server's mime only when the path has no
    // matching language registered. Pending files have no server content-type,
    // so the path lookup is the only signal.
    const fromPath = useLanguageForPath(effectivePath ?? undefined)
    const fromMime = useLanguageForMime(
        fileFetch.kind === 'loaded' ? fileFetch.bytes.contentType : undefined,
    )
    const language = fromPath ?? fromMime

    // Per-language editor services (LSP extensions, goto-def, diagnostics, ...).
    // The language module owns its LSP wiring; this component just hosts the
    // binding and renders any UI from its snapshot. Languages with no rich
    // services (JSON, plaintext) simply return null below.
    const knownPaths = useMemo(() => [...fileTreeFiles.keys()], [fileTreeFiles])

    // Stable accessor for the engine API doc. The bundle resolves once, early;
    // a getter (read via ref) lets the binding see it without being rebuilt.
    const engineApi = useEngineApi()
    const engineApiRef = useRef(engineApi)
    engineApiRef.current = engineApi
    const getEngineApiDoc = useCallback(
        () => (engineApiRef.current.status === 'ready' ? engineApiRef.current.bundle.doc : null),
        [],
    )

    // Stable callbacks for the binding. `showUsages` derives sourceText from
    // the current TextModel each invocation — kept here so the language
    // module doesn't need to reach into the model layer.
    const showUsagesForBinding = useCallback(
        (matches: UsageMatch[], anchorPos: number, sourceRange: { from: number; to: number }) => {
            const api = editorApiRef.current
            if (!api) return
            const model = textModels.get(docId)
            const sourceText = model
                ? model.content.peek().slice(sourceRange.from, sourceRange.to) || 'symbol'
                : 'symbol'
            api.showUsages(sourceText, matches, anchorPos, sourceRange)
        },
        [docId, textModels],
    )

    // Construct the binding once per (language, uri) combination. Disposed on
    // unmount or when the binding's identity changes (e.g. file rename).
    const binding: LanguageEditorBinding | null = useMemo(() => {
        if (!language?.createEditorServices || !effectivePath) return null
        return language.createEditorServices({
            lsp: project.lsp,
            uri: fileUriFromPath(effectivePath),
            path: effectivePath,
            knownPaths,
            openEditor,
            showUsages: showUsagesForBinding,
            getEngineApiDoc,
        })
    }, [
        language,
        effectivePath,
        project.lsp,
        knownPaths,
        openEditor,
        showUsagesForBinding,
        getEngineApiDoc,
    ])

    useEffect(() => {
        return () => binding?.dispose()
    }, [binding])

    const subscribeServices = useCallback(
        (cb: () => void) => (binding ? binding.subscribe(cb) : () => {}),
        [binding],
    )
    const getServicesSnapshot = useCallback(
        () => (binding ? binding.getSnapshot() : EMPTY_EDITOR_SERVICES),
        [binding],
    )
    const editorServices = useSyncExternalStore(
        subscribeServices,
        getServicesSnapshot,
        getServicesSnapshot,
    )

    const extraExtensions = editorServices.extensions
    const goToDefinitionAt = editorServices.gotoDefinitionAt
    const suppressCmdClickUsages = editorServices.suppressCmdClickUsages ?? false
    const suppressFoldGutter = editorServices.suppressFoldGutter ?? false
    const diagnosticCounts = editorServices.diagnosticCounts ?? EMPTY_DIAGNOSTIC_COUNTS

    // Open / close the TextModel on mount / unmount. The service refcounts
    // so multiple tabs of the same file share a single model.
    const initialContent = useMemo(() => {
        if (fileFetch.kind === 'loaded') return decodeText(fileFetch.bytes)
        return ''
    }, [fileFetch])

    const openedRef = useRef(false)
    useEffect(() => {
        if (openedRef.current) return
        if (isExistingFile && fileFetch.kind !== 'loaded') return
        textModels.getOrOpen(docId, initialContent)
        openedRef.current = true
    }, [docId, textModels, isExistingFile, fileFetch.kind, initialContent])

    useEffect(() => {
        return () => {
            if (openedRef.current) textModels.close(docId)
            openedRef.current = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [docId])

    // Subscribe to the model's content for rendering. `useSignal` bridges
    // the model's `content` ReadonlySignal into React state.
    const model = textModels.get(docId)
    const content = useSignal(model ? model.content : EMPTY_STRING_SIGNAL)
    const dirty = useSignal(model ? model.dirty : EMPTY_BOOL_SIGNAL)

    const setContent = useCallback(
        (next: string) => {
            textModels.get(docId)?.setContent(next)
        },
        [docId, textModels],
    )

    // Register the editor view + resolved language + save handler under this
    // tab's id so globally-bound actions (`editor.format`, `editor.save`) can
    // locate the right tab when fired from outside the editor's focus. Re-runs
    // implicitly when CodeEditor remounts the view (e.g. when `language`
    // changes). A ref forwards the latest `save` closure so the registered
    // entry always sees current state.
    const saveRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
    const lspUri = effectivePath ? fileUriFromPath(effectivePath) : undefined
    const activeEditor = project.activeEditor
    const onViewChange = useCallback(
        (view: EditorView | null) => {
            if (view) {
                activeEditor.register(tab.id, {
                    view,
                    language,
                    save: () => saveRef.current(),
                    lspUri,
                })
            } else {
                activeEditor.unregister(tab.id)
            }
        },
        [activeEditor, tab.id, language, lspUri],
    )
    useEffect(() => {
        return () => {
            activeEditor.unregister(tab.id)
        }
    }, [activeEditor, tab.id])

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
        layout.updateTab(tab.id, {
            payload: { path: payload.path, tempId: payload.tempId },
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: scrub on each new hint
    }, [initialScrollToLine, initialFlashLspRange])

    // Convert the LSP-coord flash range to document offsets once the
    // document is loaded.
    const flashRange = useMemo(() => {
        if (!initialFlashLspRange) return undefined
        if (!model) return undefined
        const text = model.content.peek()
        const r = initialFlashLspRange
        const from = lspPosToOffset(text, r.startLine, r.startCharacter)
        const to = lspPosToOffset(text, r.endLine, r.endCharacter)
        if (to <= from) return undefined
        return { from, to }
        // Recompute when the model identity or hint changes — both are the
        // signals that should re-fire the effect.
    }, [initialFlashLspRange, model])

    const saveAtPath = useCallback(
        async (path: string): Promise<boolean> => {
            const result = await textModels.save(docId, { path })
            if (!result.ok) {
                setSaveError(result.error.kind === 'network' ? result.error.cause : result.error)
                return false
            }
            // Patch the tab: drop tempId, point at path. TextModelService
            // already rekeyed the model and removed the pending entry.
            if (path !== docId) {
                layout.updateTab(tab.id, {
                    title: basename(path),
                    payload: { path },
                })
            }
            setSaveError(null)
            return true
        },
        [docId, textModels, tab.id, layout],
    )

    const save = useCallback((): Promise<boolean> => {
        const m = textModels.get(docId)
        if (!m || !m.dirty.peek()) return Promise.resolve(true)
        if (effectivePath) return saveAtPath(effectivePath)
        setSavePromptOpen(true)
        return Promise.resolve(false)
    }, [docId, textModels, effectivePath, saveAtPath])

    // Keep the active-editor-registry's save handler in sync with the latest
    // closure. The registered handler reads through this ref so it always
    // observes current state.
    useEffect(() => {
        saveRef.current = save
    }, [save])

    // Autosave is now driven inside `TextModelService` — one effect per
    // model, trailing-edge timer. No React effect here.

    if (isExistingFile && fileFetch.kind === 'loading') {
        return <Status>Loading {basename(effectivePath ?? '')}…</Status>
    }
    if (isExistingFile && fileFetch.kind === 'error') {
        return <Status tone='error'>Failed to load: {String(fileFetch.error)}</Status>
    }
    if (!model) {
        return <Status>Preparing editor…</Status>
    }

    void dirty
    return (
        <div className='relative flex h-full flex-col'>
            <div className='relative min-h-0 flex-1'>
                <CodeEditor
                    value={content}
                    onChange={setContent}
                    language={language}
                    extraExtensions={extraExtensions}
                    onGoToDefinitionAt={goToDefinitionAt}
                    suppressCmdClickUsages={suppressCmdClickUsages}
                    suppressFoldGutter={suppressFoldGutter}
                    apiRef={editorApiRef}
                    onViewChange={onViewChange}
                    scrollToLine={initialScrollToLine}
                    flashRange={flashRange}
                    onBlur={() => {
                        if (effectivePath) void save()
                    }}
                />
                {language?.createEditorServices && lspUri ? (
                    <DiagnosticIndicator
                        counts={diagnosticCounts}
                        uri={lspUri}
                        docText={content}
                        apiRef={editorApiRef}
                    />
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

function decodeText(bytes: MapFileBytes): string {
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

type Severity = 1 | 2 | 3 | 4

function DiagnosticIndicator({
    counts,
    uri,
    docText,
    apiRef,
}: {
    counts: DiagnosticCounts
    uri: string
    docText: string
    apiRef: React.RefObject<CodeEditorApi | null>
}) {
    const { client } = useLuauLsp()
    const [open, setOpen] = useState(false)
    const diagnostics = useDiagnosticsForUri(client, uri)

    const isClean = counts.total === 0

    // Close on outside click / escape.
    const containerRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            const c = containerRef.current
            if (c && e.target instanceof Node && c.contains(e.target)) return
            setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        window.addEventListener('pointerdown', onPointerDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true)
            window.removeEventListener('keydown', onKey)
        }
    }, [open])

    const handleJump = useCallback(
        (d: Diagnostic) => {
            const offset = lspPosToOffset(docText, d.range.start.line, d.range.start.character)
            apiRef.current?.jumpTo(offset)
            setOpen(false)
        },
        [apiRef, docText],
    )

    return (
        <div ref={containerRef} className='absolute right-3 top-2 z-10 flex flex-col items-end'>
            {isClean ? (
                <span
                    className='border-border bg-popover flex h-7 w-7 items-center justify-center rounded-md border text-emerald-400 shadow-sm'
                    role='status'
                    aria-label='No diagnostics'
                >
                    <CheckIcon className='size-4' />
                </span>
            ) : (
                <button
                    type='button'
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    aria-label={`${counts.total} diagnostic${counts.total === 1 ? '' : 's'} in this file`}
                    className={cn(
                        'border-border bg-popover text-popover-foreground flex items-center gap-1.5 rounded-md border px-2 py-1 text-[0.7rem] font-medium shadow-sm outline-none transition-colors',
                        'hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-primary/30',
                    )}
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
                </button>
            )}
            {open && diagnostics.length > 0 ? (
                <DiagnosticList diagnostics={diagnostics} onJump={handleJump} />
            ) : null}
        </div>
    )
}

function DiagnosticList({
    diagnostics,
    onJump,
}: {
    diagnostics: readonly Diagnostic[]
    onJump: (d: Diagnostic) => void
}) {
    const sorted = useMemo(() => {
        return diagnostics.toSorted((a, b) => {
            const sa = a.severity ?? 1
            const sb = b.severity ?? 1
            if (sa !== sb) return sa - sb
            return a.range.start.line - b.range.start.line
        })
    }, [diagnostics])
    return (
        <div
            role='listbox'
            className='border-border bg-popover text-popover-foreground mt-1 flex max-h-[60vh] w-72 flex-col overflow-y-auto rounded-md border shadow-md'
        >
            {sorted.map((d, i) => {
                const sev = (d.severity ?? 1) as Severity
                return (
                    <button
                        key={i}
                        type='button'
                        onClick={() => onJump(d)}
                        className='hover:bg-muted/60 flex items-start gap-2 px-2 py-1.5 text-left text-xs outline-none transition-colors focus-visible:bg-muted/60'
                    >
                        <SeverityIcon severity={sev} />
                        <span className='flex min-w-0 flex-1 flex-col gap-px'>
                            <span className='break-words'>{d.message}</span>
                            <span className='text-muted-foreground text-[0.65rem]'>
                                {(d.source ?? 'luau') + ' · ln ' + (d.range.start.line + 1)}
                            </span>
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

const SEVERITY_CLASS: Record<Severity, string> = {
    1: 'text-destructive',
    2: 'text-yellow-300',
    3: 'text-sky-300',
    4: 'text-muted-foreground',
}

function SeverityIcon({ severity }: { severity: Severity }) {
    const className = cn('h-3 w-3 shrink-0 mt-0.5', SEVERITY_CLASS[severity])
    switch (severity) {
        case 1:
            return <AlertCircleIcon className={className} aria-label='Error' />
        case 2:
            return <AlertTriangleIcon className={className} aria-label='Warning' />
        case 3:
            return <InfoIcon className={className} aria-label='Info' />
        case 4:
            return <LightbulbIcon className={className} aria-label='Hint' />
    }
}

function useDiagnosticsForUri(_client: unknown, uri: string | null): readonly Diagnostic[] {
    // Delegates to the model-layer hook. `client` is accepted for
    // back-compat with the previous call sites but ignored — the model
    // hook reads from `Project.lsp.diagnosticsForUri(uri)`.
    return modelUseDiagnosticsForUri(uri)
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
