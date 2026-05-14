import { EditorView, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'

// CodeMirror tags the editor root with `.cm-focused` while focused. We layer
// two themes on top of `highlightActiveLine` + `highlightActiveLineGutter` so
// the same row gets a primary-tinted highlight when focused and a
// secondary-tinted one when blurred — both spanning text + line numbers.
// The active row spans three side-by-side boxes: line-numbers gutter, fold
// gutter, then the content. Round only the outer edges (leftmost gutter on
// the left, content on the right) so the row reads as one continuous pill —
// rounding every box would draw three separate pills with gaps.
const activeLineTheme = EditorView.theme({
    // Strip default green tint. Round only the outer edges of the row so the
    // line-numbers gutter, fold gutter, and content read as one continuous
    // pill instead of three separate rounded boxes with gaps between them.
    '.cm-activeLine': {
        backgroundColor: 'transparent',
        borderTopRightRadius: '6px',
        borderBottomRightRadius: '6px',
    },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-iconNumberGutter .cm-activeLineGutter, .cm-lineNumbers .cm-activeLineGutter': {
        borderTopLeftRadius: '6px',
        borderBottomLeftRadius: '6px',
    },

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
