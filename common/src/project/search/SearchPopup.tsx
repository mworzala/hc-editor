import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from 'react'
import { BookIcon, FileIcon, ListTreeIcon } from 'lucide-react'

import {
    cn,
    Dialog,
    DialogOverlay,
    DialogPopup,
    DialogPortal,
    Input,
    ScrollArea,
} from '@hollowcube/design-system'

import { listAllLanguageMimes, useLanguages } from '../../editor/languages'
import { useLayout, type WorkspaceLayoutService } from '../../model/workspace'
import { useProjectActionsForLayout } from '../actions/project-actions'
import { useRunAction } from '../actions/registry'
import { DOCS_EDITOR_KIND } from '../editors/docs-kind'
import { isTextContentType } from '../tools/files-tree'
import { useSearchStore } from './search-store'
import { useActionResults } from './sources/actions'
import { useDocsResults } from './sources/docs'
import { useFileResults } from './sources/files'
import { useWorkspaceSymbolResults } from './sources/symbols'
import { useTextSearchResults } from './sources/text'
import { SEARCH_TABS, type ResultGroup, type SearchResult, type SearchTab } from './types'

// Top-center floating popup. Renders inside base-ui's Dialog so we inherit
// focus trap, ESC, and outside-click handling — we override only the
// positioning className.

export function SearchPopup() {
    const open = useSearchStore((s) => s.open)
    const close = useSearchStore((s) => s.close)
    return (
        <Dialog
            open={open}
            onOpenChange={(next: boolean) => {
                if (!next) close()
            }}
        >
            <DialogPortal>
                <DialogOverlay />
                <DialogPopup
                    aria-label='Search'
                    className={cn(
                        'fixed top-[12vh] left-1/2 z-50 -translate-x-1/2',
                        'w-[640px] max-w-[calc(100vw-2rem)]',
                        'flex flex-col gap-2 p-2',
                        'rounded-xl bg-popover text-popover-foreground ring-1 ring-border shadow-xl outline-none',
                        'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                    )}
                >
                    {open ? <SearchPopupContent /> : null}
                </DialogPopup>
            </DialogPortal>
        </Dialog>
    )
}

function SearchPopupContent() {
    const layout = useLayout()
    const tab = useSearchStore((s) => s.tab)
    const setTab = useSearchStore((s) => s.setTab)
    const query = useSearchStore((s) => s.query)
    const setQuery = useSearchStore((s) => s.setQuery)
    const close = useSearchStore((s) => s.close)

    const { groups, textState } = useResults(tab, query)
    const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups])
    const [activeId, setActiveId] = useActiveResult(flatItems)

    const inputRef = useRef<HTMLInputElement | null>(null)
    useEffect(() => {
        // Autofocus the input each time the popup opens. The store resets
        // query on open, so the cursor lands in an empty field.
        inputRef.current?.focus()
    }, [])

    const invoke = useInvoke(close, layout)

    const onKeyDown = useCallback(
        (e: ReactKeyboardEvent<HTMLInputElement>) => {
            // ArrowUp/ArrowDown drive the result list selection — they must NOT
            // also move the input's text cursor (or trigger any global hotkey
            // that happens to be bound to arrow keys). ArrowLeft/ArrowRight
            // intentionally fall through so the user can still navigate the
            // query text.
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                e.stopPropagation()
                if (flatItems.length === 0) return
                const idx = flatItems.findIndex((x) => x.id === activeId)
                const next = flatItems[(idx + 1) % flatItems.length]
                if (next) setActiveId(next.id)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                e.stopPropagation()
                if (flatItems.length === 0) return
                const idx = flatItems.findIndex((x) => x.id === activeId)
                const next = flatItems[(idx - 1 + flatItems.length) % flatItems.length]
                if (next) setActiveId(next.id)
                return
            }
            if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                const target = flatItems.find((x) => x.id === activeId)
                if (target) invoke(target)
                return
            }
            if (e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation()
                const idx = SEARCH_TABS.findIndex((t) => t.id === tab)
                const dir = e.shiftKey ? -1 : 1
                const next = SEARCH_TABS[(idx + dir + SEARCH_TABS.length) % SEARCH_TABS.length]
                if (next) setTab(next.id)
                return
            }
        },
        [activeId, flatItems, invoke, setActiveId, setTab, tab],
    )

    return (
        <>
            <TabBar tab={tab} onChange={setTab} />
            <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholderFor(tab)}
                className='h-9 text-sm'
                aria-label='Search query'
            />
            <ResultsList
                groups={groups}
                activeId={activeId}
                onActivate={setActiveId}
                onInvoke={invoke}
                tab={tab}
                footer={
                    (tab === 'text' || tab === 'all') && textState.total > 0 ? (
                        <TextSearchStatus state={textState} />
                    ) : null
                }
            />
        </>
    )
}

// --- tab bar ---

function TabBar({ tab, onChange }: { tab: SearchTab; onChange: (tab: SearchTab) => void }) {
    return (
        <div className='flex items-center gap-1 px-1 pt-1' role='tablist'>
            {SEARCH_TABS.map((t) => {
                const active = t.id === tab
                return (
                    <button
                        key={t.id}
                        type='button'
                        role='tab'
                        aria-selected={active}
                        onClick={() => onChange(t.id)}
                        className={cn(
                            'inline-flex h-7 items-center gap-1 rounded-md px-2 text-[0.75rem] leading-none font-medium select-none transition-colors outline-none',
                            'focus-visible:ring-3 focus-visible:ring-primary/30',
                            active
                                ? 'bg-secondary text-secondary-foreground'
                                : 'text-foreground/60 hover:bg-muted/40 hover:text-foreground',
                        )}
                    >
                        {t.label}
                    </button>
                )
            })}
        </div>
    )
}

// --- results list ---

function ResultsList({
    groups,
    activeId,
    onActivate,
    onInvoke,
    tab,
    footer,
}: {
    groups: readonly ResultGroup[]
    activeId: string | null
    onActivate: (id: string) => void
    onInvoke: (result: SearchResult) => void
    tab: SearchTab
    footer?: ReactNode
}) {
    const empty = groups.every((g) => g.items.length === 0)
    if (empty) {
        return (
            <>
                <div className='px-3 py-6 text-center text-xs text-muted-foreground'>
                    No results.
                </div>
                {footer}
            </>
        )
    }
    return (
        <>
            <ScrollArea className='max-h-[50vh] min-h-0'>
                <div className='flex flex-col gap-1 px-1 pb-1' role='listbox'>
                    {groups.map((g) =>
                        g.items.length === 0 ? null : (
                            <div key={g.kind} className='flex flex-col gap-px'>
                                {tab === 'all' ? <GroupHeader label={g.label} /> : null}
                                {g.items.map((item) => (
                                    <ResultRow
                                        key={item.id}
                                        item={item}
                                        active={item.id === activeId}
                                        onMouseEnter={() => onActivate(item.id)}
                                        onClick={() => onInvoke(item)}
                                    />
                                ))}
                            </div>
                        ),
                    )}
                </div>
            </ScrollArea>
            {footer}
        </>
    )
}

function GroupHeader({ label }: { label: string }) {
    return (
        <div className='px-2 pt-1.5 pb-0.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground'>
            {label}
        </div>
    )
}

function ResultRow({
    item,
    active,
    onMouseEnter,
    onClick,
}: {
    item: SearchResult
    active: boolean
    onMouseEnter: () => void
    onClick: () => void
}) {
    const icon = resultIcon(item)
    const keybinding = item.kind === 'action' ? item.keybinding : undefined
    return (
        <button
            type='button'
            role='option'
            aria-selected={active}
            onMouseEnter={onMouseEnter}
            onClick={onClick}
            className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] outline-none transition-colors',
                active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-foreground/85 hover:bg-muted/40',
            )}
        >
            <span
                className={cn(
                    'inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-3.5',
                    active ? 'text-secondary-foreground' : 'text-muted-foreground',
                )}
            >
                {icon}
            </span>
            <span className='min-w-0 flex-1 truncate'>
                <HighlightedText text={item.title} matches={item.matches} />
            </span>
            {item.subtitle ? (
                <span
                    className={cn(
                        'truncate text-[0.7rem]',
                        active ? 'text-secondary-foreground/70' : 'text-muted-foreground',
                    )}
                >
                    {item.subtitle}
                </span>
            ) : null}
            {keybinding ? (
                <kbd className='inline-flex h-5 shrink-0 items-center rounded border border-border bg-muted/40 px-1.5 font-mono text-[10px] text-muted-foreground'>
                    {formatKeybinding(keybinding)}
                </kbd>
            ) : null}
        </button>
    )
}

function HighlightedText({ text, matches }: { text: string; matches: readonly number[] }) {
    if (matches.length === 0) return <>{text}</>
    const set = new Set(matches)
    const parts: { ch: string; hit: boolean }[] = []
    for (let i = 0; i < text.length; i++) {
        parts.push({ ch: text[i]!, hit: set.has(i) })
    }
    return (
        <>
            {parts.map((p, i) =>
                p.hit ? (
                    <span key={i} className='font-semibold text-primary'>
                        {p.ch}
                    </span>
                ) : (
                    <span key={i}>{p.ch}</span>
                ),
            )}
        </>
    )
}

function resultIcon(item: SearchResult) {
    if (item.kind === 'action' && item.icon) return item.icon
    if (item.kind === 'file') return <FileIcon />
    if (item.kind === 'symbol') return <ListTreeIcon />
    if (item.kind === 'docs') return <BookIcon />
    return null
}

// --- result wiring ---

function useResults(
    tab: SearchTab,
    query: string,
): {
    groups: readonly ResultGroup[]
    textState: {
        results: readonly SearchResult[]
        loading: boolean
        scanned: number
        total: number
    }
} {
    const actions = useActionResults(query, tab === 'all' ? 5 : 50)
    const files = useFileResults(query, tab === 'all' ? 5 : 50)
    // Docs are an in-memory fuzzy match (no network) — always computed.
    const docs = useDocsResults(query, tab === 'all' ? 5 : 50)
    // Workspace symbols query the LSP — only fire when the symbol tab is
    // active or All is selected, otherwise the user pays for the round-trip
    // while filtering Actions / Files.
    const symbolsActive = tab === 'symbols' || tab === 'all'
    const symbols = useWorkspaceSymbolResults(symbolsActive ? query : '')
    // Only run the text scan when the tab actually shows text results.
    // Otherwise pass an empty query so the hook stays idle and doesn't
    // hammer the network as the user filters Actions / Files.
    const textActive = tab === 'text' || tab === 'all'
    const textState = useTextSearchResults(textActive ? query : '')

    const groups = useMemo<readonly ResultGroup[]>(() => {
        if (tab === 'actions') {
            return [{ kind: 'action', label: 'Actions', items: actions }]
        }
        if (tab === 'files') {
            return [{ kind: 'file', label: 'Files', items: files }]
        }
        if (tab === 'symbols') {
            return [{ kind: 'symbol', label: 'Symbols', items: symbols }]
        }
        if (tab === 'docs') {
            return [{ kind: 'docs', label: 'Docs', items: docs }]
        }
        if (tab === 'text') {
            return [{ kind: 'text', label: 'Text', items: textState.results }]
        }
        // 'all' — grouped union with a small per-section cap
        return [
            { kind: 'action', label: 'Actions', items: actions },
            { kind: 'file', label: 'Files', items: files },
            { kind: 'symbol', label: 'Symbols', items: symbols.slice(0, 5) },
            { kind: 'docs', label: 'Docs', items: docs.slice(0, 5) },
            { kind: 'text', label: 'Text', items: textState.results.slice(0, 5) },
        ]
    }, [tab, actions, files, symbols, docs, textState.results])

    return { groups, textState }
}

function TextSearchStatus({
    state,
}: {
    state: { loading: boolean; scanned: number; total: number }
}) {
    if (state.total === 0) return null
    return (
        <div className='px-3 py-1.5 text-[0.65rem] text-muted-foreground border-t border-border'>
            {state.loading
                ? `Scanning ${state.scanned}/${state.total} text files…`
                : `Scanned ${state.total} text file${state.total === 1 ? '' : 's'}`}
        </div>
    )
}

function useActiveResult(items: readonly SearchResult[]) {
    const activeId = useMemo(() => items[0]?.id ?? null, [items])
    const ref = useRef<string | null>(activeId)
    // Track current selection independently so hover/keypress can override.
    const sticky = useRef<string | null>(null)
    if (activeId !== ref.current) {
        ref.current = activeId
        // Reset sticky if the previous selection no longer exists.
        if (sticky.current && !items.some((i) => i.id === sticky.current)) {
            sticky.current = null
        }
    }
    const current = sticky.current ?? activeId
    const setActive = useCallback((id: string) => {
        sticky.current = id
    }, [])
    return [current, setActive] as const
}

function useInvoke(close: () => void, layout: WorkspaceLayoutService) {
    const runAction = useRunAction()
    const { openEditor } = useProjectActionsForLayout(layout)
    const languages = useLanguages()
    const languageMimes = useMemo(() => listAllLanguageMimes(languages), [languages])
    return useCallback(
        (result: SearchResult) => {
            switch (result.kind) {
                case 'action': {
                    runAction(result.data.id, { source: 'palette' })
                    close()
                    return
                }
                case 'file': {
                    const file = result.data
                    if (!isTextContentType(file.contentType, languageMimes)) {
                        close()
                        return
                    }
                    openEditor({
                        mimeType: file.contentType,
                        payload: { path: file.path },
                        identityKey: 'path',
                        title: result.title,
                    })
                    close()
                    return
                }
                case 'text': {
                    const hit = result.data
                    openEditor({
                        // text/plain is the safe default — the text editor's
                        // mimeTypes pattern matches text/*.
                        mimeType: 'text/plain',
                        payload: { path: hit.path, scrollToLine: hit.line },
                        identityKey: 'path',
                    })
                    close()
                    return
                }
                case 'symbol': {
                    const sym = result.data
                    openEditor({
                        mimeType: 'text/plain',
                        payload: {
                            path: sym.path,
                            scrollToLine: sym.line,
                            flashLspRange: {
                                startLine: sym.line - 1,
                                startCharacter: sym.column,
                                endLine: sym.line - 1,
                                endCharacter: sym.column + sym.name.length,
                            },
                        },
                        identityKey: 'path',
                    })
                    close()
                    return
                }
                case 'docs': {
                    const { moduleId, symbol } = result.data
                    openEditor({
                        kind: DOCS_EDITOR_KIND,
                        payload: { moduleId, symbol },
                        identityKey: 'moduleId',
                        title: result.title,
                    })
                    close()
                    return
                }
            }
        },
        [close, openEditor, runAction, languageMimes],
    )
}

function placeholderFor(tab: SearchTab): string {
    switch (tab) {
        case 'all':
            return 'Search everywhere…'
        case 'actions':
            return 'Find action…'
        case 'files':
            return 'Go to file…'
        case 'symbols':
            return 'Go to symbol…'
        case 'docs':
            return 'Search docs…'
        case 'text':
            return 'Search in files…'
    }
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/u.test(navigator.platform)

function formatKeybinding(binding: string): string {
    // @tanstack/react-hotkeys uses `$mod` as the platform-cmd. Translate for
    // display alongside other tokens.
    return binding
        .split('+')
        .map((tok) => {
            const t = tok.trim().toLowerCase()
            if (t === '$mod') return IS_MAC ? '⌘' : 'Ctrl'
            if (t === 'shift') return IS_MAC ? '⇧' : 'Shift'
            if (t === 'alt') return IS_MAC ? '⌥' : 'Alt'
            if (t === 'ctrl') return IS_MAC ? '⌃' : 'Ctrl'
            if (t === 'meta') return IS_MAC ? '⌘' : 'Meta'
            return tok.length === 1 ? tok.toUpperCase() : tok[0]!.toUpperCase() + tok.slice(1)
        })
        .join(IS_MAC ? '' : '+')
}
