import {
    autocompletion,
    completionKeymap,
    startCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete'
import { type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

// Mock JSON schema — values returned regardless of cursor context. For a real
// LSP we'd swap this source out; the popup theming + behavior stays the same.

type CompletionType = 'property' | 'value' | 'keyword' | 'command'

type MockCompletion = {
    label: string
    type: CompletionType
    detail: string
    info?: string
    boost?: number
}

const SCHEMA: MockCompletion[] = [
    { label: 'name', type: 'property', detail: 'string', info: 'Package name', boost: 10 },
    {
        label: 'version',
        type: 'property',
        detail: 'string',
        info: 'Semver version',
        boost: 10,
    },
    {
        label: 'description',
        type: 'property',
        detail: 'string',
        info: 'Short package description',
        boost: 9,
    },
    { label: 'private', type: 'property', detail: 'boolean', boost: 9 },
    { label: 'type', type: 'property', detail: '"module" | "commonjs"', boost: 9 },
    { label: 'main', type: 'property', detail: 'string' },
    { label: 'module', type: 'property', detail: 'string' },
    { label: 'scripts', type: 'property', detail: 'Record<string, string>', boost: 8 },
    { label: 'dependencies', type: 'property', detail: 'Record<string, string>', boost: 8 },
    { label: 'devDependencies', type: 'property', detail: 'Record<string, string>', boost: 8 },
    { label: 'engines', type: 'property', detail: 'Record<string, string>', boost: 6 },
    { label: 'keywords', type: 'property', detail: 'string[]' },
    { label: 'license', type: 'property', detail: 'string' },
    { label: 'author', type: 'property', detail: 'string | { name, email }' },
    // Common script names (used in value position; still surfaced for the demo).
    { label: 'start', type: 'command', detail: 'script' },
    { label: 'build', type: 'command', detail: 'script' },
    { label: 'dev', type: 'command', detail: 'script' },
    { label: 'test', type: 'command', detail: 'script' },
    { label: 'preview', type: 'command', detail: 'script' },
    { label: 'lint', type: 'command', detail: 'script' },
    { label: 'format', type: 'command', detail: 'script' },
    { label: 'typecheck', type: 'command', detail: 'script' },
    // Keywords / literals
    { label: 'true', type: 'keyword', detail: 'boolean' },
    { label: 'false', type: 'keyword', detail: 'boolean' },
    { label: 'null', type: 'keyword', detail: 'literal' },
]

// Per-type symbol + tone for the icon column.
const TYPE_GLYPH: Record<CompletionType, { glyph: string; tone: string }> = {
    property: { glyph: 'P', tone: 'oklch(0.7 0.13 285)' }, // purple-ish
    value: { glyph: 'V', tone: 'oklch(0.78 0.12 200)' }, // teal
    keyword: { glyph: 'K', tone: 'oklch(0.78 0.12 200)' }, // teal
    command: { glyph: '$', tone: 'oklch(0.82 0.14 80)' }, // yellow
}

function renderIcon(type: CompletionType) {
    const meta = TYPE_GLYPH[type]
    const node = document.createElement('span')
    node.className = 'cm-hcCompletionGlyph'
    node.style.color = meta.tone
    node.textContent = meta.glyph
    return node
}

function jsonSchemaSource(context: CompletionContext): CompletionResult | null {
    // Word at cursor — letters/digits/underscores. Explicit (Mod+Space) is the
    // only trigger path so we don't need to filter on weird positions.
    const word = context.matchBefore(/[\w-]*/u)
    if (!word) return null
    if (word.from === word.to && !context.explicit) return null

    const options: Completion[] = SCHEMA.map((c) => ({
        label: c.label,
        type: c.type,
        detail: c.detail,
        info: c.info,
        boost: c.boost,
    }))

    return {
        from: word.from,
        options,
        validFor: /^[\w-]*$/u,
    }
}

const completionTheme = EditorView.theme({
    '.cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        boxShadow: '0 10px 24px rgba(0,0,0,0.45)',
        padding: '4px',
        fontFamily: "'JetBrains Sans', ui-sans-serif, system-ui, sans-serif",
        fontSize: '12px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: 'inherit',
        maxWidth: '380px',
        minWidth: '240px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
        display: 'grid',
        gridTemplateColumns: '18px 1fr auto',
        alignItems: 'center',
        columnGap: '8px',
        padding: '4px 6px',
        borderRadius: '4px',
        lineHeight: '1',
        color: 'var(--popover-foreground)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li:hover': {
        backgroundColor: 'color-mix(in oklab, var(--foreground) 8%, transparent)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--secondary)',
        color: 'var(--secondary-foreground)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li > .cm-completionIcon': {
        display: 'none',
    },
    '.cm-hcCompletionGlyph': {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        fontWeight: '600',
        fontSize: '11px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li .cm-completionLabel': {
        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li .cm-completionMatchedText': {
        textDecoration: 'none',
        color: 'var(--primary)',
        fontWeight: '600',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li .cm-completionDetail': {
        fontStyle: 'normal',
        color: 'var(--muted-foreground)',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        fontFamily: "'JetBrains Sans', ui-sans-serif, system-ui, sans-serif",
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail': {
        color: 'color-mix(in oklab, var(--secondary-foreground) 75%, transparent)',
    },
    // Info popup (the secondary tooltip shown for the selected item)
    '.cm-tooltip.cm-completionInfo': {
        backgroundColor: 'var(--popover)',
        color: 'var(--popover-foreground)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: '6px 8px',
        fontFamily: "'JetBrains Sans', ui-sans-serif, system-ui, sans-serif",
        fontSize: '11.5px',
        maxWidth: '280px',
    },
})

export function jsonCompletion(): Extension {
    return [
        autocompletion({
            activateOnTyping: false,
            override: [jsonSchemaSource],
            icons: false,
            addToOptions: [
                {
                    render: (completion) =>
                        renderIcon((completion.type ?? 'value') as CompletionType),
                    position: 10,
                },
            ],
        }),
        keymap.of([{ key: 'Mod-Space', run: startCompletion }, ...completionKeymap]),
        completionTheme,
    ]
}
