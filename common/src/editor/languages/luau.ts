import { createHighlighter, type Highlighter } from 'shiki'

import { formatLuau } from '../formatters/stylua'
import { createLuauEditorBinding } from './luau-editor-services'
import luauGrammar from './Luau.tmLanguage.json'
import { shikiHighlight } from './shikiHighlight'
import { type LanguageDefinition } from './types'

const LUAU_THEME_NAME = 'fleet-transparent'

// Custom dark theme aligned with the editor chrome (transparent background,
// JetBrains-ish accents). Mirrors the prior art's palette.
const fleetTransparentTheme = {
    name: LUAU_THEME_NAME,
    type: 'dark',
    colors: {
        'editor.foreground': '#d4d4d4',
        'editor.background': '#00000000',
    },
    tokenColors: [
        {
            scope: ['comment', 'punctuation.definition.comment'],
            settings: { foreground: '#5d6b85' },
        },
        {
            scope: ['keyword', 'storage.type', 'storage.modifier', 'keyword.control'],
            settings: { foreground: '#00bba7' },
        },
        {
            scope: ['string', 'string.quoted', 'string.template'],
            settings: { foreground: '#c27aff' },
        },
        {
            scope: ['constant.numeric', 'constant.language'],
            settings: { foreground: '#e7c87c' },
        },
        {
            scope: ['entity.name.function', 'meta.function-call', 'support.function'],
            settings: { foreground: '#a6c4ff' },
        },
        {
            scope: ['variable.parameter'],
            settings: { foreground: '#d8a657' },
        },
        {
            scope: ['entity.name.type', 'support.type'],
            settings: { foreground: '#7cd5d8' },
        },
        {
            scope: ['punctuation', 'meta.brace', 'meta.bracket', 'meta.delimiter'],
            settings: { foreground: '#cccccc' },
        },
    ],
} satisfies Parameters<typeof createHighlighter>[0]['themes'][number]

let highlighterPromise: Promise<Highlighter> | null = null

function getLuauHighlighter(): Promise<Highlighter> {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighter({
            themes: [fleetTransparentTheme],
            langs: [
                {
                    ...(luauGrammar as object),
                    name: 'luau',
                    scopeName: 'source.luau',
                } as Parameters<typeof createHighlighter>[0]['langs'][number],
            ],
        })
    }
    return highlighterPromise
}

export const LUAU_LANGUAGE_ID = 'luau'

export const luauLanguage: LanguageDefinition = {
    id: LUAU_LANGUAGE_ID,
    mimeTypes: ['application/luau', 'text/x-luau'],
    extensions: ['.luau', '.lua'],
    cmExtension: () => shikiHighlight('luau', LUAU_THEME_NAME, getLuauHighlighter),
    formatter: formatLuau,
    createEditorServices: (deps) => createLuauEditorBinding(deps),
}
