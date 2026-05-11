import { Facet, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
    Decoration,
    EditorView,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
} from '@codemirror/view'

export type HighlightRange = { from: number; to: number }

// Caller-provided ranges to highlight (e.g. search hits, usages).
export const highlightRangesFacet = Facet.define<
    readonly HighlightRange[],
    readonly HighlightRange[]
>({
    combine: (values) => values.flat(),
})

const highlightMark = Decoration.mark({ class: 'cm-highlightRange' })

function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>()
    const ranges = view.state.facet(highlightRangesFacet)
    const sorted = [...ranges].toSorted((a, b) => a.from - b.from)
    for (const r of sorted) {
        if (r.from < r.to) builder.add(r.from, r.to, highlightMark)
    }
    return builder.finish()
}

const highlightPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet
        constructor(view: EditorView) {
            this.decorations = buildDecorations(view)
        }
        update(u: ViewUpdate) {
            if (
                u.docChanged ||
                u.viewportChanged ||
                u.startState.facet(highlightRangesFacet) !== u.state.facet(highlightRangesFacet)
            ) {
                this.decorations = buildDecorations(u.view)
            }
        }
    },
    {
        decorations: (v) => v.decorations,
    },
)

const highlightTheme = EditorView.theme({
    '.cm-highlightRange': {
        backgroundColor: 'color-mix(in oklab, var(--primary) 22%, transparent)',
        borderRadius: '2px',
    },
})

export function highlightRangesExtension(): Extension {
    return [highlightPlugin, highlightTheme]
}
