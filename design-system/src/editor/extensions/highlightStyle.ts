import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

import { type EditorPalette } from '../themes'

export function editorHighlightStyle(p: EditorPalette) {
    const style = HighlightStyle.define([
        // JSON property key — purple
        { tag: t.propertyName, color: p.property },
        // Strings — pink
        { tag: [t.string, t.special(t.string), t.character], color: p.string },
        // Numbers — yellow
        { tag: [t.number, t.integer, t.float], color: p.number },
        // Booleans / null — teal
        { tag: [t.bool, t.null], color: p.keyword },
        // Keywords — teal
        { tag: t.keyword, color: p.keyword },
        // Constants
        { tag: [t.constant(t.name), t.standard(t.name)], color: p.constant },
        // Punctuation / brackets / commas
        {
            tag: [t.bracket, t.squareBracket, t.brace, t.paren, t.punctuation, t.separator],
            color: p.punctuation,
        },
        // Operators
        { tag: [t.operator, t.compareOperator, t.arithmeticOperator], color: p.operator },
        // Comments
        { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: p.comment },
        // Function names
        { tag: [t.function(t.variableName), t.function(t.propertyName)], color: p.function },
        // Variables / identifiers
        { tag: [t.variableName, t.name], color: p.variable },
        // Escape sequences inside strings
        { tag: t.escape, color: p.escape },
        // Invalid
        { tag: t.invalid, color: p.invalid },
    ])
    return syntaxHighlighting(style)
}
