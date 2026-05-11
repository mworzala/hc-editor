import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import {
    bracketMatching,
    defaultHighlightStyle,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import { cn } from '@hollowcube/design-system/lib/utils'
import * as React from 'react'

import { activeLineHighlight } from './extensions/activeLine'
import { wideFoldGutter } from './extensions/foldGutter'
import { editorHighlightStyle } from './extensions/highlightStyle'
import { iconGutterMap, iconNumberGutter } from './extensions/iconGutter'
import { editorTheme } from './extensions/theme'
import { armadaDark } from './themes'

export type CodeEditorProps = {
    value: string
    onChange?: (next: string) => void
    /** Currently `'json'` only. Lookup table for more languages to follow. */
    language?: 'json'
    readOnly?: boolean
    /** Map of 1-indexed line numbers to raw HTML (e.g. an SVG icon). When set
     *  for a line, the icon REPLACES the line number entirely for that row. */
    gutterIcons?: Record<number, string>
    className?: string
}

function CodeEditor({
    value,
    onChange,
    language = 'json',
    readOnly = false,
    gutterIcons,
    className,
}: CodeEditorProps) {
    const hostRef = React.useRef<HTMLDivElement | null>(null)
    const viewRef = React.useRef<EditorView | null>(null)

    // Compartments for the bits we reconfigure after mount.
    const readOnlyCompartmentRef = React.useRef(new Compartment())
    const iconsCompartmentRef = React.useRef(new Compartment())

    // Mount once.
    React.useEffect(() => {
        const host = hostRef.current
        if (!host) return

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged && onChange) {
                onChange(update.state.doc.toString())
            }
        })

        const languageExt = language === 'json' ? json() : []

        const state = EditorState.create({
            doc: value,
            extensions: [
                iconNumberGutter(),
                wideFoldGutter(),
                history(),
                drawSelection(),
                indentOnInput(),
                bracketMatching(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                languageExt,
                activeLineHighlight(),
                editorTheme(armadaDark),
                editorHighlightStyle(armadaDark),
                keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
                readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly)),
                iconsCompartmentRef.current.of(iconGutterMap.of(gutterIcons ?? {})),
                updateListener,
            ],
        })

        const view = new EditorView({ state, parent: host })
        viewRef.current = view
        return () => {
            view.destroy()
            viewRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language])

    // Sync external value changes.
    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        const current = view.state.doc.toString()
        if (current === value) return
        view.dispatch({
            changes: { from: 0, to: current.length, insert: value },
        })
    }, [value])

    // Sync read-only flag.
    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(readOnly)),
        })
    }, [readOnly])

    // Sync gutter icons.
    React.useEffect(() => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
            effects: iconsCompartmentRef.current.reconfigure(iconGutterMap.of(gutterIcons ?? {})),
        })
    }, [gutterIcons])

    return <div ref={hostRef} className={cn('h-full w-full overflow-hidden', className)} />
}

export { CodeEditor }
