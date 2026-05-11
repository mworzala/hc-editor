import { EditorView } from '@codemirror/view'

import { type EditorPalette } from '../themes'

export function editorTheme(p: EditorPalette) {
    return EditorView.theme(
        {
            '&': {
                color: p.foreground,
                backgroundColor: 'transparent',
                fontFamily: "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace",
                fontSize: '13px',
                height: '100%',
            },
            '.cm-scroller': {
                fontFamily: 'inherit',
                lineHeight: '1.55',
            },
            '.cm-content': {
                caretColor: p.caret,
                padding: '8px 0',
            },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.caret },
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
                {
                    background: p.selectionBg,
                },
            '&:not(.cm-focused) .cm-selectionBackground': {
                background: p.selectionInactiveBg,
            },

            // Gutters
            '.cm-gutters': {
                backgroundColor: 'transparent',
                color: p.gutterFg,
                border: 'none',
            },
            '.cm-gutterElement': {
                padding: '0 6px 0 8px',
            },
            '.cm-lineNumbers .cm-gutterElement': {
                color: p.gutterFg,
                minWidth: '2ch',
            },
            '.cm-activeLineGutter': {
                backgroundColor: 'transparent',
                color: p.gutterActiveFg,
            },

            // Indent guides (if extension enabled later)
            '.cm-indent-guide': {
                borderLeft: `1px solid ${p.indentGuide}`,
            },

            // Tooltips / autocomplete popup (defaults — re-themed per feature later)
            '.cm-tooltip': {
                backgroundColor: 'var(--popover)',
                color: 'var(--popover-foreground)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
            },
        },
        { dark: true },
    )
}
