import { useCallback, useMemo } from 'react'
import type {
    CodeAction,
    CodeActionContext,
    Command,
    Diagnostic,
    Range,
    WorkspaceEdit,
} from 'vscode-languageserver-types'

/** LSP `PrepareRenameResult` covers three response shapes the server can
 *  send. `vscode-languageserver-types` doesn't ship a union for it, so we
 *  inline the discriminator here. */
type PrepareRenameResult =
    | (Range & { placeholder?: never })
    | { range: Range; placeholder: string }
    | { defaultBehavior: true }

import { stringTokenAt } from '../../editor/extensions/tokens'
import { useLuauLsp, useProject } from '../../model'
import { useLayout } from '../../model/workspace'
import { useRegisterAction, type Action, type ActionRunContext } from '../../project/actions'
import { findLeaf } from '../../workspace'
import { offsetToPosition, rangeToOffsets } from '../cm/lspUtils'
import { type LspClient } from '../LspClient'
import { useLspUiBus } from './lsp-ui-context'

// Registers globally-bound LSP actions (code-action + rename). Both resolve
// the focused editor through `getActiveEditor`, fetch from the LSP, and open
// floating UI via the LspUiBus. Mounted as a sibling of `<EditorActions />`
// in the project workspace.

export function LspActions() {
    const bus = useLspUiBus()
    const layout = useLayout()
    const activeEditor = useProject().activeEditor
    const lsp = useLuauLsp()

    const resolveContext = useCallback(() => {
        if (!lsp.client || lsp.status !== 'running') return null
        const state = layout.state.peek()
        const leafId = state.focusedLeafId
        if (!leafId) return null
        const leaf = findLeaf(state.center, leafId)
        if (!leaf || !leaf.activeId) return null
        const entry = activeEditor.get(leaf.activeId)
        if (!entry || !entry.lspUri) return null
        return { client: lsp.client, uri: entry.lspUri, view: entry.view }
    }, [lsp, layout, activeEditor])

    const runCodeAction = useCallback(
        async (_ctx: ActionRunContext) => {
            const ctx = resolveContext()
            if (!ctx) return
            const { client, uri, view } = ctx
            const selection = view.state.selection.main
            const lspRange: Range = {
                start: offsetToPosition(view.state.doc, selection.from),
                end: offsetToPosition(view.state.doc, selection.to),
            }
            const overlapping = overlappingDiagnostics(client.getDiagnostics(uri), lspRange)
            const codeActionContext: CodeActionContext = {
                diagnostics: overlapping,
                only: undefined,
                triggerKind: 1,
            }
            let result: (CodeAction | Command)[] | null = null
            try {
                result = await client.sendRequest<(CodeAction | Command)[] | null>(
                    'textDocument/codeAction',
                    { textDocument: { uri }, range: lspRange, context: codeActionContext },
                )
            } catch (err) {
                console.warn('[lsp] codeAction failed', err)
                return
            }
            const items = (result ?? []).filter((a) => !(a as CodeAction).disabled) as (
                | CodeAction
                | Command
            )[]

            const coords = view.coordsAtPos(selection.head)
            const x = coords?.left ?? window.innerWidth / 2
            const y = (coords?.bottom ?? window.innerHeight / 2) + 4

            bus.openCodeActionMenu({
                x,
                y,
                items,
                onSelect: (item) => {
                    void applyCodeAction(client, item)
                },
            })
        },
        [bus, resolveContext],
    )

    const runRename = useCallback(
        async (_ctx: ActionRunContext) => {
            const ctx = resolveContext()
            if (!ctx) return
            const { client, uri, view } = ctx
            const head = view.state.selection.main.head
            const lspPos = offsetToPosition(view.state.doc, head)

            let initialName = ''
            let anchorOffset = head

            // Prefer the server's prepareRename when available — it returns
            // the canonical symbol range + placeholder text.
            try {
                const prep = await client.sendRequest<PrepareRenameResult | null>(
                    'textDocument/prepareRename',
                    { textDocument: { uri }, position: lspPos },
                )
                if (prep) {
                    if ('placeholder' in prep && typeof prep.placeholder === 'string') {
                        initialName = prep.placeholder
                        const r = rangeToOffsets(view.state.doc, prep.range)
                        anchorOffset = r.from
                    } else if ('range' in prep) {
                        const r = rangeToOffsets(view.state.doc, (prep as { range: Range }).range)
                        anchorOffset = r.from
                        initialName = view.state.doc.sliceString(r.from, r.to)
                    } else if ('start' in prep && 'end' in prep) {
                        // Plain Range form
                        const r = rangeToOffsets(view.state.doc, prep as unknown as Range)
                        anchorOffset = r.from
                        initialName = view.state.doc.sliceString(r.from, r.to)
                    }
                }
            } catch {
                // Server doesn't support prepareRename — fall back to token at cursor.
            }

            if (!initialName) {
                const token = stringTokenAt(view, head)
                if (!token) return
                initialName = token.token
                anchorOffset = token.from
            }

            const coords = view.coordsAtPos(anchorOffset)
            const x = coords?.left ?? window.innerWidth / 2
            const y = (coords?.bottom ?? window.innerHeight / 2) + 4

            bus.openRenamePrompt({
                x,
                y,
                initialName,
                onConfirm: (newName) => {
                    void doRename(client, uri, lspPos, newName)
                },
            })
        },
        [bus, resolveContext],
    )

    const codeActionAction = useMemo<Action>(
        () => ({
            id: 'editor.codeAction',
            title: 'Quick Fix / Refactor…',
            group: 'edit',
            keybinding: '$mod+.',
            contexts: ['editor:text', 'lsp.luau.running'],
            run: runCodeAction,
        }),
        [runCodeAction],
    )

    const renameAction = useMemo<Action>(
        () => ({
            id: 'editor.rename',
            title: 'Rename Symbol',
            group: 'edit',
            keybinding: 'f2',
            contexts: ['editor:text', 'lsp.luau.running'],
            run: runRename,
        }),
        [runRename],
    )

    useRegisterAction(codeActionAction)
    useRegisterAction(renameAction)
    return null
}

function overlappingDiagnostics(diagnostics: readonly Diagnostic[], range: Range): Diagnostic[] {
    return diagnostics.filter((d) => rangesOverlap(d.range, range))
}

function rangesOverlap(a: Range, b: Range): boolean {
    if (cmp(a.end, b.start) < 0) return false
    if (cmp(b.end, a.start) < 0) return false
    return true
}

function cmp(a: { line: number; character: number }, b: { line: number; character: number }) {
    if (a.line !== b.line) return a.line - b.line
    return a.character - b.character
}

async function applyCodeAction(client: LspClient, item: CodeAction | Command): Promise<void> {
    // Two-shape handling: CodeAction (has `edit` / `command`) vs. raw Command
    // (just `command` + `arguments`).
    const isCommand = !('kind' in item) && 'command' in item && typeof item.command === 'string'
    if (isCommand) {
        const cmd = item as Command
        try {
            await client.executeCommand(cmd.command, cmd.arguments)
        } catch (err) {
            console.warn('[lsp] executeCommand failed', err)
        }
        return
    }
    let action = item as CodeAction
    if (!action.edit && !action.command && action.data !== undefined) {
        // Server advertised resolveProvider — fill in the edit lazily.
        try {
            const resolved = await client.sendRequest<CodeAction | null>(
                'codeAction/resolve',
                action,
            )
            if (resolved) action = resolved
        } catch (err) {
            console.warn('[lsp] codeAction/resolve failed', err)
            return
        }
    }
    if (action.edit) {
        // Round-trip back through the server's apply-edit channel so the
        // server sees the change before any follow-up command runs.
        await applyEditViaServer(client, action.edit)
    }
    if (action.command) {
        try {
            await client.executeCommand(action.command.command, action.command.arguments)
        } catch (err) {
            console.warn('[lsp] code action command failed', err)
        }
    }
}

async function applyEditViaServer(client: LspClient, edit: WorkspaceEdit): Promise<void> {
    // Same code path the server uses for `workspace/applyEdit`. LspBufferBridge
    // observes the document-store mutation and sends `didChange` so the LSP
    // mirror stays in sync.
    await client.applyWorkspaceEdit(edit)
}

async function doRename(
    client: LspClient,
    uri: string,
    position: { line: number; character: number },
    newName: string,
): Promise<void> {
    let result: WorkspaceEdit | null = null
    try {
        result = await client.sendRequest<WorkspaceEdit | null>('textDocument/rename', {
            textDocument: { uri },
            position,
            newName,
        })
    } catch (err) {
        console.warn('[lsp] rename failed', err)
        return
    }
    if (!result) return
    await applyEditViaServer(client, result)
}
