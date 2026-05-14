import { type EditorView } from '@codemirror/view'
import diff from 'fast-diff'

import { type FormatResult, type LanguageDefinition } from '../languages/types'

// Single source of truth for "format the document in this view". All three
// entry points (the CM keymap binding, the editor's right-click action, and
// the globally-registered hotkey action) funnel through here so the doc-read /
// formatter-call / dispatch sequence stays in one place.
//
// We diff the old and new text and dispatch the result as minimal hunks
// instead of one big whole-doc replace. That lets CM6's automatic selection
// mapping preserve the user's cursor and selections across formats even when
// long lines get wrapped or rewrapped.

type ChangeSpec = { from: number; to: number; insert: string }

export type RunFormatOutcome = { ok: true } | { ok: false; error: string }

export async function runFormatOnView(
    view: EditorView | null,
    language: LanguageDefinition | undefined,
): Promise<RunFormatOutcome> {
    if (!view) return { ok: false, error: 'No active editor' }
    const formatter = language?.formatter
    if (!formatter) return { ok: false, error: 'No formatter available for this language' }
    const doc = view.state.doc.toString()
    let result: FormatResult
    try {
        result = await formatter(doc)
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (!result.ok) return { ok: false, error: result.error }
    if (result.text === doc) return { ok: true }

    const cursorHint = view.state.selection.main.head
    const changes = diffToChanges(doc, result.text, cursorHint)
    if (changes.length === 0) return { ok: true }
    view.dispatch({ changes })
    return { ok: true }
}

// Walk a fast-diff chunk list and emit a CM6 ChangeSpec for each run of
// non-equal chunks. Adjacent delete+insert pairs collapse into a single
// replace so the resulting hunks are tight and CM6's selection mapper sees
// "this range was rewritten to that" instead of "deleted then inserted".
function diffToChanges(oldText: string, newText: string, cursorHint: number): ChangeSpec[] {
    const chunks = diff(oldText, newText, cursorHint)
    const changes: ChangeSpec[] = []
    let pos = 0
    let i = 0
    while (i < chunks.length) {
        const chunk = chunks[i]!
        if (chunk[0] === 0) {
            pos += chunk[1].length
            i++
            continue
        }
        let delText = ''
        let insText = ''
        while (i < chunks.length && chunks[i]![0] !== 0) {
            const [op, text] = chunks[i]!
            if (op === -1) delText += text
            else insText += text
            i++
        }
        changes.push({ from: pos, to: pos + delText.length, insert: insText })
        pos += delText.length
    }
    return changes
}
