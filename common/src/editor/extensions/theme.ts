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
            // CodeMirror's default focused outline is a 1px dotted ring; suppress it.
            '&.cm-focused': { outline: 'none' },
            '.cm-scroller': {
                fontFamily: 'inherit',
                lineHeight: '1.55',
            },
            '.cm-content': {
                caretColor: p.caret,
                padding: '8px 0',
            },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: p.caret },
            // Synthetic selection layer: full-opacity primary band.
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
                {
                    background: 'var(--primary)',
                    borderRadius: '4px',
                },
            // Native selection on top of the layer: transparent background so we
            // don't double-paint, white text so syntax colors give way to a
            // legible high-contrast reading on the band.
            '.cm-content ::selection': {
                background: 'transparent',
                color: '#ffffff',
            },
            '&:not(.cm-focused) .cm-selectionBackground': {
                background: p.selectionInactiveBg,
            },

            // Gutters
            '.cm-gutters': {
                backgroundColor: 'transparent',
                color: 'var(--foreground)',
                border: 'none',
            },
            '.cm-gutterElement': {
                padding: '0 6px 0 8px',
            },
            '.cm-lineNumbers .cm-gutterElement': {
                color: 'var(--foreground)',
                minWidth: '2ch',
            },
            '.cm-iconNumberGutter .cm-gutterElement': {
                color: 'var(--foreground)',
            },
            '.cm-activeLineGutter': {
                backgroundColor: 'transparent',
                color: 'var(--foreground)',
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
                boxShadow:
                    '0 4px 12px rgba(0, 0, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden',
            },

            // LSP hover popover. The DOM is built in lsp/cm/hover.ts.
            '.cm-hc-hover': {
                maxWidth: '480px',
                fontSize: '12px',
                lineHeight: '1.45',
            },
            '.cm-hc-hover-section': {
                padding: '8px 10px',
            },
            '.cm-hc-hover-divider': {
                height: '1px',
                background: 'var(--border)',
                margin: '0',
            },
            '.cm-hc-hover-diagnostics': {
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
            },
            '.cm-hc-hover-diagnostic': {
                display: 'flex',
                alignItems: 'flex-start',
                gap: '6px',
            },
            '.cm-hc-hover-diagnostic-tag': {
                flex: '0 0 auto',
                fontSize: '10px',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                padding: '1px 5px',
                borderRadius: '3px',
                lineHeight: '14px',
                whiteSpace: 'nowrap',
            },
            '.cm-hc-hover-diagnostic-tag-error': {
                background: 'color-mix(in srgb, ' + p.diagnosticError + ' 18%, transparent)',
                color: p.diagnosticError,
            },
            '.cm-hc-hover-diagnostic-tag-warning': {
                background: 'color-mix(in srgb, ' + p.diagnosticWarning + ' 18%, transparent)',
                color: p.diagnosticWarning,
            },
            '.cm-hc-hover-diagnostic-tag-info': {
                background: 'color-mix(in srgb, ' + p.diagnosticInfo + ' 18%, transparent)',
                color: p.diagnosticInfo,
            },
            '.cm-hc-hover-diagnostic-tag-hint': {
                background: 'color-mix(in srgb, ' + p.diagnosticHint + ' 18%, transparent)',
                color: p.diagnosticHint,
            },
            '.cm-hc-hover-diagnostic-msg': {
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
            },
            '.cm-hc-hover-markdown': {
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
            },
            '.cm-hc-hover-code': {
                background: 'color-mix(in srgb, var(--foreground) 6%, transparent)',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                padding: '6px 8px',
                fontSize: '11.5px',
                margin: '0',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
            },
            '.cm-hc-hover-text': {
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
            },

            // Completion popup. Matches the app's popover surface and uses
            // JetBrains-style colored letter icons for each completion kind.
            '.cm-tooltip.cm-tooltip-autocomplete': {
                padding: '4px',
                fontFamily: 'inherit',
                fontSize: '12px',
                lineHeight: '1.5',
                minWidth: '220px',
                maxWidth: '420px',
            },
            '.cm-tooltip-autocomplete > ul': {
                fontFamily: 'inherit',
                maxHeight: '260px',
                minWidth: '0',
                margin: '0',
                padding: '0',
            },
            '.cm-tooltip-autocomplete > ul > li': {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 6px',
                borderRadius: '4px',
                color: 'var(--popover-foreground)',
                cursor: 'pointer',
                lineHeight: '1.3',
            },
            // Selected row: chain `.cm-tooltip` for higher specificity so we
            // beat the autocomplete library's own `&dark` baseTheme defaults
            // (the tooltip portals outside the editor's `.cm-dark` root).
            '.cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': {
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
            },
            '.cm-completionIcon': {
                flex: '0 0 auto',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                borderRadius: '4px',
                fontFamily: 'inherit',
                fontSize: '10px',
                fontWeight: '600',
                fontStyle: 'normal',
                lineHeight: '1',
                color: '#1e1f22',
                background: 'color-mix(in srgb, var(--foreground) 35%, transparent)',
                padding: '0',
                opacity: '1',
                textAlign: 'center',
                marginRight: '0',
            },
            '.cm-completionIcon::after': {
                content: 'attr(data-glyph)',
            },
            '.cm-completionIcon-method::after, .cm-completionIcon-function::after': {
                content: '"f"',
            },
            '.cm-completionIcon-method, .cm-completionIcon-function': {
                background: '#a6c4ff',
            },
            '.cm-completionIcon-property::after': { content: '"p"' },
            '.cm-completionIcon-property': { background: '#af9cff' },
            '.cm-completionIcon-variable::after': { content: '"v"' },
            '.cm-completionIcon-variable': { background: '#e0e1e4' },
            '.cm-completionIcon-class::after, .cm-completionIcon-interface::after': {
                content: '"c"',
            },
            '.cm-completionIcon-class, .cm-completionIcon-interface': {
                background: '#7cd5d8',
            },
            '.cm-completionIcon-enum::after': { content: '"e"' },
            '.cm-completionIcon-enum': { background: '#ebc88d' },
            '.cm-completionIcon-keyword::after': { content: '"k"' },
            '.cm-completionIcon-keyword': { background: '#82d2ce' },
            '.cm-completionIcon-constant::after': { content: '"#"' },
            '.cm-completionIcon-constant': { background: '#ebc88d' },
            '.cm-completionIcon-type::after': { content: '"t"' },
            '.cm-completionIcon-type': { background: '#7cd5d8' },
            '.cm-completionIcon-namespace::after': { content: '"n"' },
            '.cm-completionIcon-namespace': { background: '#d8a657' },
            '.cm-completionIcon-event::after': { content: '"e"' },
            '.cm-completionIcon-event': { background: '#e394dc' },
            '.cm-completionIcon-text::after': { content: '"a"' },
            '.cm-completionIcon-text': {
                background: 'color-mix(in srgb, var(--foreground) 30%, transparent)',
            },
            '.cm-completionLabel': {
                flex: '1 1 auto',
                fontFamily:
                    "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace",
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            },
            '.cm-completionMatchedText': {
                color: 'inherit',
                textDecoration: 'none',
                fontWeight: '600',
            },
            '.cm-completionDetail': {
                flex: '0 1 auto',
                marginLeft: 'auto',
                paddingLeft: '8px',
                color: 'color-mix(in srgb, currentColor 55%, transparent)',
                fontStyle: 'normal',
                fontFamily:
                    "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, monospace",
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '50%',
            },
            '.cm-tooltip.cm-completionInfo': {
                padding: '6px 8px',
                fontSize: '12px',
                lineHeight: '1.5',
                maxWidth: '420px',
                whiteSpace: 'pre-wrap',
            },

            // Inline diagnostic underlines — flat 2px bar drawn just below
            // the text baseline (overrides @codemirror/lint's squiggle).
            // Implemented via background-image so we can: (a) inset the bar
            // a couple of pixels up from the bottom of the inline box so it
            // sits closer to the glyphs, and (b) clip the bar's corners via
            // the host's border-radius for a softer look.
            '.cm-lintRange': {
                backgroundImage: 'none',
                paddingBottom: '0',
                borderRadius: '1px',
                backgroundRepeat: 'no-repeat',
                backgroundSize: '100% 2px',
                backgroundPosition: '0 calc(100% - 1px)',
            },
            '.cm-lintRange-error': {
                backgroundImage: `linear-gradient(${p.diagnosticError}, ${p.diagnosticError})`,
            },
            '.cm-lintRange-warning': {
                backgroundImage: `linear-gradient(${p.diagnosticWarning}, ${p.diagnosticWarning})`,
            },
            '.cm-lintRange-info': {
                backgroundImage: `linear-gradient(${p.diagnosticInfo}, ${p.diagnosticInfo})`,
            },
            '.cm-lintRange-hint': {
                backgroundImage: `linear-gradient(${p.diagnosticHint}, ${p.diagnosticHint})`,
            },
        },
        { dark: true },
    )
}
