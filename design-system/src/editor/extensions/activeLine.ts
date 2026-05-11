import { EditorView, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'

// CodeMirror tags the editor root with `.cm-focused` while focused. We layer
// two themes on top of `highlightActiveLine` + `highlightActiveLineGutter` so
// the same row gets a primary-tinted highlight when focused and a
// secondary-tinted one when blurred — both spanning text + line numbers.
const activeLineTheme = EditorView.theme({
    // Strip default green tint
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },

    // Focused: primary at low opacity
    '&.cm-focused .cm-activeLine, &.cm-focused .cm-activeLineGutter': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 14%, transparent)',
    },

    // Blurred: secondary at lower opacity
    '&:not(.cm-focused) .cm-activeLine, &:not(.cm-focused) .cm-activeLineGutter': {
        backgroundColor: 'color-mix(in oklab, var(--secondary) 50%, transparent)',
    },
})

export function activeLineHighlight() {
    return [highlightActiveLine(), highlightActiveLineGutter(), activeLineTheme]
}
