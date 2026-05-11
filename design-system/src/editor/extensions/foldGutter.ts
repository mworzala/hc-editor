import { foldGutter } from '@codemirror/language'
import { EditorView } from '@codemirror/view'

// Lucide `chevron-down` — points down when foldable region is open (click to
// fold). When the region is collapsed we rotate the same marker -90° so it
// points right (click to expand).
function buildMarker(isOpen: boolean) {
    const span = document.createElement('span')
    span.className = 'cm-foldMarker'
    span.dataset.state = isOpen ? 'open' : 'closed'
    span.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="m6 9 6 6 6-6"/>' +
        '</svg>'
    return span
}

const foldGutterTheme = EditorView.theme({
    '.cm-foldGutter': {
        width: '22px',
    },
    '.cm-foldGutter .cm-gutterElement': {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0',
        cursor: 'pointer',
        color: 'var(--muted-foreground)',
        transition: 'color 80ms ease',
    },
    '.cm-foldGutter .cm-gutterElement:hover': {
        color: 'var(--foreground)',
    },
    '.cm-foldMarker': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
        transition: 'transform 80ms ease',
    },
    '.cm-foldMarker[data-state="closed"]': {
        transform: 'rotate(-90deg)',
    },
})

export function wideFoldGutter() {
    return [
        foldGutter({
            markerDOM: buildMarker,
        }),
        foldGutterTheme,
    ]
}
