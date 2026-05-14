// Server-driven `workspace/applyEdit` → document-store mutations.
//
// The LSP can hand us text edits across one or many open documents (code
// actions, rename, executeCommand-produced edits). We apply them by sorting
// each file's edits in reverse order and splicing the buffer in the
// DocumentStore. The store's subscription in `LspBufferBridge` then sends
// `textDocument/didChange` back to the server — we do NOT publish it here.
//
// File-op entries in `documentChanges` (CreateFile / RenameFile / DeleteFile)
// are refused (return `false`) until a filesystem mutation primitive exists.
// Refusing an entire edit on a single unsupported op is intentional: applying
// the text portion while skipping the file op would leave server and client
// out of sync.

import type { Position, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'

import type { DocumentStore } from '../project/documents/store'
import { flattenWorkspaceEdit } from './LspClient'
import { pathFromFileUri } from './uriResolver'

export function createApplyWorkspaceEditHandler(
    documents: DocumentStore,
): (edit: WorkspaceEdit) => boolean {
    return (edit) => {
        if (!edit) return false

        if (edit.documentChanges) {
            for (const change of edit.documentChanges) {
                if (!('textDocument' in change)) {
                    console.warn(
                        '[lsp] applyWorkspaceEdit: file-op (create/rename/delete) not supported yet',
                        change,
                    )
                    return false
                }
            }
        }

        const groups = flattenWorkspaceEdit(edit)
        if (groups.length === 0) return true

        const state = documents.getState()
        // Pre-flight: every targeted document must be open. Partial application
        // would desync the server's mirror.
        for (const { uri } of groups) {
            const id = docIdFromUri(uri)
            if (!state.documents[id]) {
                console.warn('[lsp] applyWorkspaceEdit: document not open', uri)
                return false
            }
        }

        for (const { uri, edits } of groups) {
            const id = docIdFromUri(uri)
            const doc = state.documents[id]
            if (!doc) continue
            const next = applyTextEdits(doc.current, edits)
            if (next === doc.current) continue
            state.setContent(id, next)
        }
        return true
    }
}

function docIdFromUri(uri: string): string {
    const path = pathFromFileUri(uri)
    return path.startsWith('/') ? path.slice(1) : path
}

/** Apply a list of `TextEdit`s to `text`. LSP guarantees non-overlap; sorting
 *  by start offset descending lets us splice without remapping positions. */
function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
    if (edits.length === 0) return text
    const lineOffsets = computeLineOffsets(text)
    const positioned = edits.map((e) => ({
        from: positionToOffset(lineOffsets, text.length, e.range.start),
        to: positionToOffset(lineOffsets, text.length, e.range.end),
        newText: e.newText,
    }))
    positioned.sort((a, b) => b.from - a.from || b.to - a.to)
    let out = text
    for (const { from, to, newText } of positioned) {
        out = out.slice(0, from) + newText + out.slice(to)
    }
    return out
}

function computeLineOffsets(text: string): number[] {
    const offsets = [0]
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') offsets.push(i + 1)
    }
    return offsets
}

function positionToOffset(lineOffsets: readonly number[], textLen: number, pos: Position): number {
    if (pos.line < 0) return 0
    if (pos.line >= lineOffsets.length) return textLen
    const lineStart = lineOffsets[pos.line]!
    const nextLineStart = lineOffsets[pos.line + 1] ?? textLen + 1
    const lineLen = Math.max(0, nextLineStart - lineStart - 1)
    return Math.min(lineStart + Math.max(0, pos.character), lineStart + lineLen)
}
