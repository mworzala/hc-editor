import { ViewPlugin, type EditorView } from '@codemirror/view'
import type { TextEdit } from 'vscode-languageserver-types'

import { type LspClient } from '../LspClient'
import { offsetToPosition, rangeToOffsets } from './lspUtils'

// On-type formatting. The server picks one or more "trigger" characters that,
// when typed, prompt it to return a list of TextEdits (typically auto-indent
// adjustments around block delimiters). We dispatch those edits directly to
// the view — this is always single-file, so the cross-file applyWorkspaceEdit
// path isn't involved.

export function lspOnTypeFormatting(client: LspClient, uri: string) {
    const caps = client.getCapabilities()?.documentOnTypeFormattingProvider
    if (!caps) return []
    const triggerSet = new Set<string>([
        caps.firstTriggerCharacter,
        ...(caps.moreTriggerCharacter ?? []),
    ])

    const fetch = async (view: EditorView, pos: number, ch: string): Promise<void> => {
        let edits: TextEdit[] | null = null
        try {
            edits = await client.sendRequest<TextEdit[] | null>(
                'textDocument/onTypeFormatting',
                {
                    textDocument: { uri },
                    position: offsetToPosition(view.state.doc, pos),
                    ch,
                    options: { tabSize: 4, insertSpaces: true },
                },
            )
        } catch {
            return
        }
        if (!edits || edits.length === 0) return

        // Apply edits in reverse offset order so earlier edits don't shift
        // later positions. Stale targets (whole-doc edit followed by intra-
        // line edit) are tolerated — CodeMirror clamps to current doc length.
        const positioned = edits.map((e) => ({
            ...rangeToOffsets(view.state.doc, e.range),
            insert: e.newText,
        }))
        positioned.sort((a, b) => b.from - a.from || b.to - a.to)
        view.dispatch({
            changes: positioned.map(({ from, to, insert }) => ({ from, to, insert })),
        })
    }

    return ViewPlugin.define((view) => ({
        update(update) {
            if (!update.docChanged) return
            let triggered = false
            let triggerCh = ''
            update.changes.iterChanges((_f, _t, _fB, _tB, inserted) => {
                if (triggered) return
                const text = inserted.toString()
                for (const c of text) {
                    if (triggerSet.has(c)) {
                        triggered = true
                        triggerCh = c
                        break
                    }
                }
            })
            if (!triggered) return
            const pos = update.state.selection.main.head
            void fetch(view, pos, triggerCh)
        },
    }))
}
