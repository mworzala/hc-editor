import {
    copyLineDown,
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
} from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import {
    bracketMatching,
    defaultHighlightStyle,
    foldAll,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
    unfoldAll,
} from '@codemirror/language'
import { openSearchPanel, search } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { cn } from '@hollowcube/design-system/lib/utils'
import * as React from 'react'

import { EditorContextMenu, type EditorContextMenuCommands } from './components/EditorContextMenu'
import { UsagesPopup, type UsageMatch } from './components/UsagesPopup'
import { activeLineHighlight } from './extensions/activeLine'
import { jsonCompletion } from './extensions/completion'
import {
    editorContextMenuExtension,
    EDITOR_CONTEXT_MENU_EVENT,
    type EditorContextMenuDetail,
} from './extensions/contextMenu'
import { wideFoldGutter } from './extensions/foldGutter'
import {
    highlightRangesFacet,
    highlightRangesExtension,
    type HighlightRange,
} from './extensions/highlightRanges'
import { editorHighlightStyle } from './extensions/highlightStyle'
import { iconGutterLineOffset, iconGutterMap, iconNumberGutter } from './extensions/iconGutter'
import { editorTheme } from './extensions/theme'
import { armadaDark } from './themes'

// Silence the unused warning while we keep the import in case the menu needs
// access to the full default-keymap action.
void copyLineDown

export type CodeEditorProps = {
    value: string
    onChange?: (next: string) => void
    /** Currently `'json'` only. Lookup table for more languages to follow. */
    language?: 'json'
    readOnly?: boolean
    /** Map of (displayed) line number → raw HTML icon. When set, the icon
     *  REPLACES the line number for that row. Keys are interpreted in the
     *  same numbering as the visible gutter (i.e. after `lineOffset`). */
    gutterIcons?: Record<number, string>
    /** Number added to the internal 1..N line numbering before display. Use
     *  this when embedding a slice of a larger file so the gutter still shows
     *  the original line numbers. */
    lineOffset?: number
    /** Character ranges in `value` to render with a primary-tinted highlight.
     *  Used for search hits, usages, and find-in-file results. */
    highlightRanges?: readonly HighlightRange[]
    /** Set to false for embedded snippets — disables completion, context menu,
     *  usages popup. Defaults to true for full editors. */
    enableInteractions?: boolean
    className?: string
}

function CodeEditor({
    value,
    onChange,
    language = 'json',
    readOnly = false,
    gutterIcons,
    lineOffset = 0,
    highlightRanges,
    enableInteractions = true,
    className,
}: CodeEditorProps) {
    const hostRef = React.useRef<HTMLDivElement | null>(null)
    const viewRef = React.useRef<EditorView | null>(null)

    const readOnlyCompartmentRef = React.useRef(new Compartment())
    const iconsCompartmentRef = React.useRef(new Compartment())
    const lineOffsetCompartmentRef = React.useRef(new Compartment())
    const highlightCompartmentRef = React.useRef(new Compartment())

    // Context menu + usages popup state — only used when interactions are on.
    const [ctxMenu, setCtxMenu] = React.useState<{
        open: boolean
        x: number
        y: number
        token: string | null
        tokenFrom: number | null
        tokenTo: number | null
    }>({ open: false, x: 0, y: 0, token: null, tokenFrom: null, tokenTo: null })

    const [usages, setUsages] = React.useState<{
        open: boolean
        token: string
        matches: UsageMatch[]
    }>({ open: false, token: '', matches: [] })

    const [flashMsg, setFlashMsg] = React.useState<string | null>(null)

    React.useEffect(() => {
        const host = hostRef.current
        if (!host) return

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged && onChange) {
                onChange(update.state.doc.toString())
            }
        })

        const languageExt = language === 'json' ? json() : []

        const extensions = [
            iconNumberGutter(),
            wideFoldGutter(),
            history(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            languageExt,
            activeLineHighlight(),
            highlightRangesExtension(),
            editorTheme(armadaDark),
            editorHighlightStyle(armadaDark),
            keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
            readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly)),
            iconsCompartmentRef.current.of(iconGutterMap.of(gutterIcons ?? {})),
            lineOffsetCompartmentRef.current.of(iconGutterLineOffset.of(lineOffset)),
            highlightCompartmentRef.current.of(highlightRangesFacet.of(highlightRanges ?? [])),
            updateListener,
        ]

        if (enableInteractions) {
            extensions.push(jsonCompletion(), search(), editorContextMenuExtension)
        }

        const state = EditorState.create({ doc: value, extensions })

        const view = new EditorView({ state, parent: host })
        viewRef.current = view
        return () => {
            view.destroy()
            viewRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, enableInteractions])

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const current = view.state.doc.toString()
        if (current === value) return
        view.dispatch({
            changes: { from: 0, to: current.length, insert: value },
        })
    }, [value])

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
        })
    }, [readOnly])

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: iconsCompartmentRef.current.reconfigure(iconGutterMap.of(gutterIcons ?? {})),
        })
    }, [gutterIcons])

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: lineOffsetCompartmentRef.current.reconfigure(
                iconGutterLineOffset.of(lineOffset),
            ),
        })
    }, [lineOffset])

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: highlightCompartmentRef.current.reconfigure(
                highlightRangesFacet.of(highlightRanges ?? []),
            ),
        })
    }, [highlightRanges])

    // Bridge CM6 contextmenu events into React state.
    React.useEffect(() => {
        if (!enableInteractions) return
        const host = hostRef.current
        if (!host) return
        const onEvent = (ev: Event) => {
            const detail = (ev as CustomEvent<EditorContextMenuDetail>).detail
            setCtxMenu({
                open: true,
                x: detail.clientX,
                y: detail.clientY,
                token: detail.token,
                tokenFrom: detail.tokenFrom,
                tokenTo: detail.tokenTo,
            })
        }
        host.addEventListener(EDITOR_CONTEXT_MENU_EVENT, onEvent as EventListener)
        return () => host.removeEventListener(EDITOR_CONTEXT_MENU_EVENT, onEvent as EventListener)
    }, [enableInteractions])

    // Auto-clear flash messages after a beat.
    React.useEffect(() => {
        if (!flashMsg) return
        const id = window.setTimeout(() => setFlashMsg(null), 1600)
        return () => window.clearTimeout(id)
    }, [flashMsg])

    const findAllUsages = React.useCallback((token: string): UsageMatch[] => {
        if (!token) return []
        const view = viewRef.current
        if (!view) return []
        const doc = view.state.doc.toString()
        const lines = doc.split('\n')
        const out: UsageMatch[] = []
        // Walk lines to capture line/col + offsets in one pass.
        let cursor = 0
        for (let li = 0; li < lines.length; li++) {
            const line = lines[li] ?? ''
            let from = 0
            while (true) {
                const idx = line.indexOf(token, from)
                if (idx === -1) break
                const matchFrom = cursor + idx
                const matchTo = matchFrom + token.length
                out.push({
                    line: li + 1,
                    col: idx + 1,
                    from: matchFrom,
                    to: matchTo,
                    snippet: line.trim(),
                })
                from = idx + token.length
            }
            cursor += line.length + 1 // +1 for the consumed newline
        }
        return out
    }, [])

    const openUsages = React.useCallback(
        (token: string | null) => {
            if (!token) return
            const matches = findAllUsages(token)
            setUsages({ open: true, token, matches })
        },
        [findAllUsages],
    )

    // Hotkey F7 = open usages for the current selection / token under cursor.
    React.useEffect(() => {
        if (!enableInteractions) return
        const host = hostRef.current
        if (!host) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'F7') return
            const view = viewRef.current
            if (!view) return
            const sel = view.state.selection.main
            const selectedText = view.state.doc.sliceString(sel.from, sel.to)
            if (selectedText) {
                e.preventDefault()
                openUsages(selectedText)
            }
        }
        host.addEventListener('keydown', onKey)
        return () => host.removeEventListener('keydown', onKey)
    }, [enableInteractions, openUsages])

    const commands: EditorContextMenuCommands = React.useMemo(
        () => ({
            token: ctxMenu.token,
            onCut: async () => {
                const view = viewRef.current
                if (!view) return
                const sel = view.state.selection.main
                if (sel.empty) return
                const text = view.state.doc.sliceString(sel.from, sel.to)
                try {
                    await navigator.clipboard.writeText(text)
                } catch {
                    /* ignore — fall back to inserting nothing */
                }
                view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } })
            },
            onCopy: async () => {
                const view = viewRef.current
                if (!view) return
                const sel = view.state.selection.main
                if (sel.empty) return
                try {
                    await navigator.clipboard.writeText(
                        view.state.doc.sliceString(sel.from, sel.to),
                    )
                } catch {
                    /* ignore */
                }
            },
            onPaste: async () => {
                const view = viewRef.current
                if (!view) return
                let text = ''
                try {
                    text = await navigator.clipboard.readText()
                } catch {
                    return
                }
                if (!text) return
                const sel = view.state.selection.main
                view.dispatch({
                    changes: { from: sel.from, to: sel.to, insert: text },
                    selection: { anchor: sel.from + text.length },
                })
            },
            onFindUsages: () => {
                openUsages(ctxMenu.token)
            },
            onGoToDefinition: () => {
                setFlashMsg('No definition available (mock — LSP not wired)')
            },
            onFormat: () => {
                const view = viewRef.current
                if (!view) return
                const doc = view.state.doc.toString()
                try {
                    const parsed = JSON.parse(doc) as unknown
                    const formatted = JSON.stringify(parsed, null, 4)
                    view.dispatch({
                        changes: { from: 0, to: doc.length, insert: formatted },
                    })
                } catch {
                    setFlashMsg('Format failed: invalid JSON')
                }
            },
            onFoldAll: () => {
                const view = viewRef.current
                if (view) foldAll(view)
            },
            onUnfoldAll: () => {
                const view = viewRef.current
                if (view) unfoldAll(view)
            },
            onFindInFile: () => {
                const view = viewRef.current
                if (view) openSearchPanel(view)
            },
        }),
        [ctxMenu.token, openUsages],
    )

    return (
        <div className={cn('relative h-full w-full overflow-hidden', className)}>
            <div ref={hostRef} className='h-full w-full' />
            {enableInteractions ? (
                <>
                    <EditorContextMenu
                        open={ctxMenu.open}
                        onOpenChange={(open) => setCtxMenu((s) => ({ ...s, open }))}
                        x={ctxMenu.x}
                        y={ctxMenu.y}
                        commands={commands}
                    />
                    <UsagesPopup
                        open={usages.open}
                        onClose={() => setUsages((s) => ({ ...s, open: false }))}
                        token={usages.token}
                        source={value}
                        matches={usages.matches}
                    />
                    {flashMsg ? (
                        <div className='pointer-events-none absolute right-4 bottom-4 rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md'>
                            {flashMsg}
                        </div>
                    ) : null}
                </>
            ) : null}
        </div>
    )
}

export { CodeEditor }
