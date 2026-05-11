import { Facet } from '@codemirror/state'
import { EditorView, gutter, GutterMarker } from '@codemirror/view'

// Strict-replacement gutter: a single column that renders either a line
// number OR a custom icon (HTML) — no number when an icon is set.
// We expose the map as a Facet so callers can reconfigure via Compartment
// without rebuilding the editor.

export const iconGutterMap = Facet.define<Record<number, string>, Record<number, string>>({
    combine: (values) => Object.assign({}, ...values),
})

class IconMarker extends GutterMarker {
    constructor(private html: string) {
        super()
    }
    override eq(other: GutterMarker): boolean {
        return other instanceof IconMarker && other.html === this.html
    }
    override toDOM() {
        const wrapper = document.createElement('span')
        wrapper.className = 'cm-iconMarker'
        wrapper.innerHTML = this.html
        return wrapper
    }
}

class NumberMarker extends GutterMarker {
    constructor(private text: string) {
        super()
    }
    override eq(other: GutterMarker): boolean {
        return other instanceof NumberMarker && other.text === this.text
    }
    override toDOM() {
        return document.createTextNode(this.text)
    }
}

const iconGutterTheme = EditorView.theme({
    '.cm-iconNumberGutter .cm-gutterElement': {
        padding: '0 6px 0 8px',
        textAlign: 'right',
        minWidth: '2ch',
        // Center icons vertically/horizontally when present
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    '.cm-iconMarker': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '16px',
        height: '16px',
    },
    '.cm-iconMarker svg': {
        width: '16px',
        height: '16px',
    },
})

export function iconNumberGutter() {
    return [
        gutter({
            class: 'cm-iconNumberGutter',
            lineMarker(view, block) {
                const lineNo = view.state.doc.lineAt(block.from).number
                const icons = view.state.facet(iconGutterMap)
                const html = icons[lineNo]
                if (html) return new IconMarker(html)
                return new NumberMarker(String(lineNo))
            },
            lineMarkerChange() {
                // Re-render any time the doc structure changes; cheap markers.
                return true
            },
            initialSpacer(view) {
                const lastLine = view.state.doc.lines
                return new NumberMarker(String(lastLine))
            },
        }),
        iconGutterTheme,
    ]
}
