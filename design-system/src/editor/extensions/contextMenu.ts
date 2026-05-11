import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'

export type EditorContextMenuDetail = {
    clientX: number
    clientY: number
    pos: number // doc offset under cursor
    token: string | null // string-literal text under cursor (without quotes), if any
    tokenFrom: number | null
    tokenTo: number | null
}

export const EDITOR_CONTEXT_MENU_EVENT = 'hc-editor-contextmenu' as const

// Looks at the syntax tree at `pos`; if the inner node is a string literal,
// returns the unquoted text + the inclusive char range of the string content
// (without the surrounding `"`).
function stringTokenAt(view: EditorView, pos: number) {
    const tree = syntaxTree(view.state)
    const node = tree.resolveInner(pos, 0)
    // JSON parser names: top is "JsonText"; strings are "String" with quotes
    // included in the range.
    if (node.name !== 'String' && node.name !== 'PropertyName') {
        // Try resolving with side=-1 (token to the left of the cursor) since
        // right-click sometimes lands on punctuation just past the string.
        const left = tree.resolveInner(pos, -1)
        if (left.name !== 'String' && left.name !== 'PropertyName') return null
        return extractStringRange(view, left.from, left.to)
    }
    return extractStringRange(view, node.from, node.to)
}

function extractStringRange(view: EditorView, from: number, to: number) {
    const raw = view.state.doc.sliceString(from, to)
    // Strip surrounding quotes if present.
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
        return { token: raw.slice(1, -1), from: from + 1, to: to - 1 }
    }
    return { token: raw, from, to }
}

export const editorContextMenuExtension = EditorView.domEventHandlers({
    contextmenu(event, view) {
        event.preventDefault()
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
        const string = pos === null ? null : stringTokenAt(view, pos)
        const detail: EditorContextMenuDetail = {
            clientX: event.clientX,
            clientY: event.clientY,
            pos: pos ?? 0,
            token: string ? string.token : null,
            tokenFrom: string ? string.from : null,
            tokenTo: string ? string.to : null,
        }
        view.dom.dispatchEvent(
            new CustomEvent(EDITOR_CONTEXT_MENU_EVENT, { detail, bubbles: true }),
        )
        return true
    },
})
