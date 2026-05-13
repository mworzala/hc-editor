import * as React from 'react'
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

import { cn } from '@hollowcube/design-system'

import { ActionContextMenu } from '../project/actions/ActionContextMenu'
import { type Action } from '../project/actions/types'
import { UsagesPopup, type UsageMatch } from './components/UsagesPopup'
import { activeLineHighlight } from './extensions/activeLine'
import {
    cmdHoverWord,
    EDITOR_CMD_LINK_EVENT,
    type EditorCmdLinkDetail,
} from './extensions/cmdHoverWord'
import { jsonCompletion } from './extensions/completion'
import {
    editorContextMenuExtension,
    EDITOR_CONTEXT_MENU_EVENT,
    type EditorContextMenuDetail,
} from './extensions/contextMenu'
import { wideFoldGutter } from './extensions/foldGutter'
import {
    highlightLinesFacet,
    highlightRangesFacet,
    highlightRangesExtension,
    type HighlightLine,
    type HighlightRange,
} from './extensions/highlightRanges'
import { editorHighlightStyle } from './extensions/highlightStyle'
import { iconGutterLineOffset, iconGutterMap, iconNumberGutter } from './extensions/iconGutter'
import { editorTheme } from './extensions/theme'
import { armadaDark } from './themes'

void copyLineDown

export type CodeEditorProps = {
    value: string
    onChange?: (next: string) => void
    language?: 'json'
    readOnly?: boolean
    gutterIcons?: Record<number, string>
    lineOffset?: number
    highlightRanges?: readonly HighlightRange[]
    /** Lines (1-indexed in the rendered doc) to fill with a yellow band. */
    highlightLines?: readonly HighlightLine[]
    /** Imperatively center this line in the viewport on mount and whenever the
     *  prop value changes. 1-indexed against the rendered doc (not source). */
    scrollToLine?: number
    /** If true, focusing the editor surfaces an onFocus callback the caller
     *  can use to jump the parent editor + close popups. */
    onFocus?: () => void
    /** Fires when the editor's contentDOM loses focus. Used by the host shell
     *  to auto-save dirty editor tabs when the user clicks away. */
    onBlur?: () => void
    /** Set to false for embedded snippets — disables completion, context menu,
     *  usages popup, cmd-hover. Defaults to true for full editors. */
    enableInteractions?: boolean
    /** Show the focused/blurred active-line tint. Defaults to
     *  `enableInteractions` so embedded snippets are quiet by default. */
    showActiveLine?: boolean
    /** Compact "single line snippet" rendering — drops gutters, vertical
     *  padding, and the active-line tint. Used for inline list-row snippets. */
    singleLine?: boolean
    /** Fires when the user presses pointer-down somewhere over the editor
     *  content; receives the resolved document position. Used by embedded
     *  snippets to jump-and-close the parent popup. */
    onPosPointerDown?: (pos: number) => void
    className?: string
}

type UsagesState = {
    open: boolean
    token: string
    matches: UsageMatch[]
    /** Editor-relative anchor info for the inline popup. */
    anchorTop: number
    anchorHeight: number
    /** Source range of the clicked occurrence (for stable highlight while open). */
    sourceFrom: number
    sourceTo: number
}

function CodeEditor({
    value,
    onChange,
    language = 'json',
    readOnly = false,
    gutterIcons,
    lineOffset = 0,
    highlightRanges,
    highlightLines,
    scrollToLine,
    onFocus,
    onBlur,
    enableInteractions = true,
    showActiveLine,
    singleLine = false,
    onPosPointerDown,
    className,
}: CodeEditorProps) {
    // Active-line tint follows interactions by default; singleLine forces it
    // off so list snippets stay quiet.
    const activeLineOn = singleLine ? false : (showActiveLine ?? enableInteractions)
    const hostRef = React.useRef<HTMLDivElement | null>(null)
    const viewRef = React.useRef<EditorView | null>(null)

    const readOnlyCompartmentRef = React.useRef(new Compartment())
    const iconsCompartmentRef = React.useRef(new Compartment())
    const lineOffsetCompartmentRef = React.useRef(new Compartment())
    const highlightCompartmentRef = React.useRef(new Compartment())
    const linesCompartmentRef = React.useRef(new Compartment())

    const [ctxMenu, setCtxMenu] = React.useState<{
        open: boolean
        x: number
        y: number
        token: string | null
        tokenFrom: number | null
        tokenTo: number | null
    }>({ open: false, x: 0, y: 0, token: null, tokenFrom: null, tokenTo: null })

    const [usages, setUsages] = React.useState<UsagesState>({
        open: false,
        token: '',
        matches: [],
        anchorTop: 0,
        anchorHeight: 0,
        sourceFrom: 0,
        sourceTo: 0,
    })

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
            history(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            languageExt,
            highlightRangesExtension(),
            editorTheme(armadaDark),
            editorHighlightStyle(armadaDark),
            keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
            readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly)),
            iconsCompartmentRef.current.of(iconGutterMap.of(gutterIcons ?? {})),
            lineOffsetCompartmentRef.current.of(iconGutterLineOffset.of(lineOffset)),
            highlightCompartmentRef.current.of(highlightRangesFacet.of(highlightRanges ?? [])),
            linesCompartmentRef.current.of(highlightLinesFacet.of(highlightLines ?? [])),
            updateListener,
        ]

        if (!singleLine) {
            extensions.unshift(iconNumberGutter(), wideFoldGutter())
        }
        if (activeLineOn) {
            extensions.push(activeLineHighlight())
        }
        if (singleLine) {
            extensions.push(
                EditorView.theme({
                    '.cm-content': { padding: '0' },
                    '.cm-line': { padding: '0' },
                    '.cm-scroller': { overflow: 'hidden' },
                }),
            )
        }

        if (enableInteractions) {
            extensions.push(jsonCompletion(), search(), editorContextMenuExtension, cmdHoverWord())
        }

        if (onPosPointerDown) {
            extensions.push(
                EditorView.domEventHandlers({
                    mousedown(event, view) {
                        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
                        if (pos !== null) onPosPointerDown(pos)
                        return false
                    },
                }),
            )
        }

        const state = EditorState.create({ doc: value, extensions })

        const view = new EditorView({ state, parent: host })
        viewRef.current = view
        return () => {
            view.destroy()
            viewRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language, enableInteractions, singleLine, activeLineOn])

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const current = view.state.doc.toString()
        if (current === value) return
        view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
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

    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: linesCompartmentRef.current.reconfigure(
                highlightLinesFacet.of(highlightLines ?? []),
            ),
        })
    }, [highlightLines])

    // Imperative scroll-to-line for embedded preview snippets.
    React.useEffect(() => {
        const view = viewRef.current
        if (!view || !scrollToLine) return
        // Wait one tick so the doc/highlights are in place.
        const id = window.requestAnimationFrame(() => {
            if (!view.state) return
            if (scrollToLine < 1 || scrollToLine > view.state.doc.lines) return
            const line = view.state.doc.line(scrollToLine)
            view.dispatch({
                effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
            })
        })
        return () => window.cancelAnimationFrame(id)
    }, [scrollToLine, value])

    // Surface focus to the parent (used by the snippet → jump-and-close flow).
    React.useEffect(() => {
        const view = viewRef.current
        if (!view || !onFocus) return
        const handler = () => onFocus()
        view.contentDOM.addEventListener('focus', handler)
        return () => view.contentDOM.removeEventListener('focus', handler)
    }, [onFocus])

    // Surface blur to the parent (used by editor hosts for auto-save on
    // unfocus). Symmetric with the onFocus plumbing above.
    React.useEffect(() => {
        const view = viewRef.current
        if (!view || !onBlur) return
        const handler = () => onBlur()
        view.contentDOM.addEventListener('blur', handler)
        return () => view.contentDOM.removeEventListener('blur', handler)
    }, [onBlur])

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
                    snippet: line,
                })
                from = idx + token.length
            }
            cursor += line.length + 1
        }
        return out
    }, [])

    /** Open the inline usages popup anchored below the line that contains
     *  `anchorPos`. If `anchorPos` is omitted the popup is anchored at the
     *  current cursor's line. */
    const openUsages = React.useCallback(
        (token: string | null, anchorPos?: number, sourceRange?: { from: number; to: number }) => {
            if (!token) return
            const matches = findAllUsages(token)
            const view = viewRef.current
            if (!view || !hostRef.current) return
            const pos = typeof anchorPos === 'number' ? anchorPos : view.state.selection.main.from
            const coords = view.coordsAtPos(pos)
            const hostRect = hostRef.current.getBoundingClientRect()
            let anchorTop = 0
            let anchorHeight = 20
            if (coords) {
                anchorTop = coords.bottom - hostRect.top
                anchorHeight = coords.bottom - coords.top
            }
            setUsages({
                open: true,
                token,
                matches,
                anchorTop,
                anchorHeight,
                sourceFrom: sourceRange?.from ?? pos,
                sourceTo: sourceRange?.to ?? pos + token.length,
            })
        },
        [findAllUsages],
    )

    const closeUsages = React.useCallback(() => {
        setUsages((s) => (s.open ? { ...s, open: false } : s))
    }, [])

    // Hotkey F7 = open usages for the current selection.
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
                openUsages(selectedText, sel.from, { from: sel.from, to: sel.to })
            }
        }
        host.addEventListener('keydown', onKey)
        return () => host.removeEventListener('keydown', onKey)
    }, [enableInteractions, openUsages])

    // Listen for cmd/ctrl-click → find usages on the linked token.
    React.useEffect(() => {
        if (!enableInteractions) return
        const host = hostRef.current
        if (!host) return
        const onLink = (ev: Event) => {
            const detail = (ev as CustomEvent<EditorCmdLinkDetail>).detail
            openUsages(detail.token, detail.anchorPos, { from: detail.from, to: detail.to })
        }
        host.addEventListener(EDITOR_CMD_LINK_EVENT, onLink as EventListener)
        return () => host.removeEventListener(EDITOR_CMD_LINK_EVENT, onLink as EventListener)
    }, [enableInteractions, openUsages])

    // Dismiss the inline popup on user interaction with the source editor.
    React.useEffect(() => {
        if (!usages.open) return
        const view = viewRef.current
        if (!view) return

        // Close on key press (typing) in the editor.
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                closeUsages()
                return
            }
            // Ignore pure-modifier presses
            if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return
            closeUsages()
        }
        // Close when user clicks outside the popup but somewhere in the page.
        const onPointerDown = (e: PointerEvent) => {
            const popup = popupRef.current
            const target = e.target as Node | null
            if (popup && target && popup.contains(target)) return
            closeUsages()
        }
        view.contentDOM.addEventListener('keydown', onKey)
        window.addEventListener('pointerdown', onPointerDown, true)
        return () => {
            view.contentDOM.removeEventListener('keydown', onKey)
            window.removeEventListener('pointerdown', onPointerDown, true)
        }
    }, [usages.open, closeUsages])

    const popupRef = React.useRef<HTMLDivElement | null>(null)

    const jumpToPos = React.useCallback(
        (pos: number) => {
            const view = viewRef.current
            if (!view) return
            view.dispatch({
                selection: { anchor: pos },
                effects: EditorView.scrollIntoView(pos, { y: 'center' }),
            })
            view.focus()
            closeUsages()
        },
        [closeUsages],
    )

    // While the popup is open, the SOURCE editor shows a primary highlight on
    // every match — including the one we clicked. Combine the consumer's
    // ranges with our overlay so we don't trample them.
    const effectiveHighlightRanges = React.useMemo<readonly HighlightRange[]>(() => {
        const base = (highlightRanges ?? []) as HighlightRange[]
        if (!usages.open) return base
        const overlay: HighlightRange[] = usages.matches.map((m) => ({
            from: m.from,
            to: m.to,
            kind: 'primary',
        }))
        return [...base, ...overlay]
    }, [highlightRanges, usages.open, usages.matches])

    // Push the effective highlights into the editor whenever they change.
    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: highlightCompartmentRef.current.reconfigure(
                highlightRangesFacet.of(effectiveHighlightRanges),
            ),
        })
    }, [effectiveHighlightRanges])

    const contextActions: Action[] = React.useMemo(() => {
        const cutAction = async () => {
            const view = viewRef.current
            if (!view) return
            const sel = view.state.selection.main
            if (sel.empty) return
            const text = view.state.doc.sliceString(sel.from, sel.to)
            try {
                await navigator.clipboard.writeText(text)
            } catch {
                /* ignore */
            }
            view.dispatch({ changes: { from: sel.from, to: sel.to, insert: '' } })
        }
        const copyAction = async () => {
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
        }
        const pasteAction = async () => {
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
        }
        const findUsages = () => {
            if (ctxMenu.token && ctxMenu.tokenFrom !== null && ctxMenu.tokenTo !== null) {
                openUsages(ctxMenu.token, ctxMenu.tokenFrom, {
                    from: ctxMenu.tokenFrom,
                    to: ctxMenu.tokenTo,
                })
            }
        }
        const goToDefinition = () => {
            setFlashMsg('No definition available (mock — LSP not wired)')
        }
        const format = () => {
            const view = viewRef.current
            if (!view) return
            const doc = view.state.doc.toString()
            try {
                const parsed = JSON.parse(doc) as unknown
                const formatted = JSON.stringify(parsed, null, 4)
                view.dispatch({ changes: { from: 0, to: doc.length, insert: formatted } })
            } catch {
                setFlashMsg('Format failed: invalid JSON')
            }
        }
        const doFoldAll = () => {
            const view = viewRef.current
            if (view) foldAll(view)
        }
        const doUnfoldAll = () => {
            const view = viewRef.current
            if (view) unfoldAll(view)
        }
        const findInFile = () => {
            const view = viewRef.current
            if (view) openSearchPanel(view)
        }
        const findUsagesTitle = ctxMenu.token
            ? `Find usages of "${ctxMenu.token}"`
            : 'Find usages'
        return [
            { id: 'editor.cut', title: 'Cut', group: 'clipboard', keybinding: '$mod+x', run: () => void cutAction() },
            { id: 'editor.copy', title: 'Copy', group: 'clipboard', keybinding: '$mod+c', run: () => void copyAction() },
            { id: 'editor.paste', title: 'Paste', group: 'clipboard', keybinding: '$mod+v', run: () => void pasteAction() },
            {
                id: 'editor.findUsages',
                title: findUsagesTitle,
                group: 'navigation',
                keybinding: 'f7',
                disabled: !ctxMenu.token,
                run: findUsages,
            },
            {
                id: 'editor.goToDefinition',
                title: 'Go to definition',
                group: 'navigation',
                keybinding: 'f12',
                run: goToDefinition,
            },
            {
                id: 'editor.format',
                title: 'Format document',
                group: 'edit',
                keybinding: 'alt+shift+f',
                run: format,
            },
            { id: 'editor.foldAll', title: 'Fold all', group: 'edit', run: doFoldAll },
            { id: 'editor.unfoldAll', title: 'Unfold all', group: 'edit', run: doUnfoldAll },
            {
                id: 'editor.findInFile',
                title: 'Find in file',
                group: 'find',
                keybinding: '$mod+f',
                run: findInFile,
            },
        ]
    }, [ctxMenu.token, ctxMenu.tokenFrom, ctxMenu.tokenTo, openUsages])

    return (
        <div className={cn('relative h-full w-full overflow-hidden px-2', className)}>
            <div ref={hostRef} className='h-full w-full' />
            {enableInteractions ? (
                <>
                    <ActionContextMenu
                        open={ctxMenu.open}
                        onOpenChange={(open) => setCtxMenu((s) => ({ ...s, open }))}
                        x={ctxMenu.x}
                        y={ctxMenu.y}
                        actions={contextActions}
                    />
                    {usages.open ? (
                        <UsagesPopup
                            ref={popupRef}
                            token={usages.token}
                            source={value}
                            matches={usages.matches}
                            anchorTop={usages.anchorTop}
                            anchorHeight={usages.anchorHeight}
                            onClose={closeUsages}
                            onJumpToPos={jumpToPos}
                        />
                    ) : null}
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
