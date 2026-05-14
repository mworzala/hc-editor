import { RangeSetBuilder } from '@codemirror/state'
import {
    Decoration,
    EditorView,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
} from '@codemirror/view'
import type { DocumentLink } from 'vscode-languageserver-types'

import { type LspClient } from '../LspClient'
import { type ResolvedUri } from '../uriResolver'
import { rangeToOffsets } from './lspUtils'
import { type DefinitionOpenHandler, type DefinitionResolver } from './definition'

// Document links — typically `require("…")` paths. The server returns ranges
// + target URIs; we render the ranges with an underline and route Cmd+click
// through the same DefinitionOpenHandler chain used by go-to-definition so
// the user lands in the right editor (project file vs. docs vs. definition
// file).

const REFRESH_DELAY = 400

const documentLinkTheme = EditorView.theme({
    '.cm-hcDocumentLink': {
        textDecoration: 'underline dotted',
        textDecorationColor: 'var(--muted-foreground)',
        textDecorationThickness: '1px',
        textUnderlineOffset: '3px',
    },
})

export function lspDocumentLinks(
    client: LspClient,
    uri: string,
    resolve: DefinitionResolver,
    onOpen: DefinitionOpenHandler,
) {
    const plugin = ViewPlugin.fromClass(
        class {
            view: EditorView
            decorations: DecorationSet = Decoration.none
            // Mirror of the last-applied links so the mousedown handler can
            // resolve a click position to a target URI without re-querying.
            ranges: { from: number; to: number; link: DocumentLink }[] = []
            timer: number | null = null
            cancelled = false

            constructor(view: EditorView) {
                this.view = view
                window.setTimeout(() => this.fetch(), 200)
            }

            update(update: ViewUpdate) {
                if (!update.docChanged) return
                if (this.timer) window.clearTimeout(this.timer)
                this.timer = window.setTimeout(() => this.fetch(), REFRESH_DELAY)
            }

            async fetch() {
                if (this.cancelled) return
                let result: DocumentLink[] | null = null
                try {
                    result = await client.sendRequest<DocumentLink[] | null>(
                        'textDocument/documentLink',
                        { textDocument: { uri } },
                    )
                } catch {
                    return
                }
                if (this.cancelled) return
                const links = result ?? []
                const builder = new RangeSetBuilder<Decoration>()
                const ranges: typeof this.ranges = []
                const sorted = [...links].toSorted((a, b) =>
                    a.range.start.line === b.range.start.line
                        ? a.range.start.character - b.range.start.character
                        : a.range.start.line - b.range.start.line,
                )
                for (const link of sorted) {
                    const { from, to } = rangeToOffsets(this.view.state.doc, link.range)
                    if (to <= from) continue
                    builder.add(from, to, Decoration.mark({ class: 'cm-hcDocumentLink' }))
                    ranges.push({ from, to, link })
                }
                this.decorations = builder.finish()
                this.ranges = ranges
                this.view.requestMeasure()
            }

            destroy() {
                this.cancelled = true
                if (this.timer) window.clearTimeout(this.timer)
            }

            linkAt(pos: number): DocumentLink | null {
                for (const r of this.ranges) {
                    if (pos >= r.from && pos <= r.to) return r.link
                }
                return null
            }

            async followLink(link: DocumentLink): Promise<void> {
                let target = link.target
                if (!target && link.data !== undefined) {
                    try {
                        const resolved = await client.sendRequest<DocumentLink | null>(
                            'documentLink/resolve',
                            link,
                        )
                        target = resolved?.target
                    } catch {
                        return
                    }
                }
                if (!target) return
                const resolvedUri: ResolvedUri = resolve(target)
                if (resolvedUri.kind === 'unknown') return
                onOpen(resolvedUri)
            }
        },
        {
            decorations: (v) => v.decorations,
            eventHandlers: {
                mousedown(event, view) {
                    if (!event.metaKey && !event.ctrlKey) return false
                    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
                    if (pos === null) return false
                    const link = this.linkAt(pos)
                    if (!link) return false
                    event.preventDefault()
                    void this.followLink(link)
                    return true
                },
            },
        },
    )
    return [documentLinkTheme, plugin]
}
