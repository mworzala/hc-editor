// Guards the `getKnownPaths` lazy-getter contract on
// `createLuauEditorBinding`. If this contract regresses (the binding
// captures the array eagerly or the dep is renamed back to a value), the
// React layer in `text.tsx` ends up rebuilding the binding on every
// `fileTree.upsert(...)` call — which mints a new `extensions` array,
// fires CodeEditor's construction effect, and remounts the `EditorView`,
// blowing away cursor/scroll/undo on every save.

import { describe, expect, test } from 'bun:test'

import { signal } from '../../model/foundation/signal'
import type { LspService } from '../../model/lsp/LspService'
import { createLuauEditorBinding } from './luau-editor-services'

function stubLspService(): LspService {
    // Minimal fake exposing only the surface the binding consumes
    // (`client.peek/subscribe`, `status.peek/subscribe`). `peek()`
    // returns null/'stopped' so `rebuildSnapshot()` short-circuits to
    // EMPTY_SNAPSHOT without touching any LSP plumbing.
    return {
        client: signal(null),
        status: signal('stopped'),
    } as unknown as LspService
}

describe('createLuauEditorBinding — getKnownPaths lazy contract', () => {
    test('does not invoke getKnownPaths at construction', () => {
        let calls = 0
        const getKnownPaths = () => {
            calls++
            return ['a.luau']
        }
        const binding = createLuauEditorBinding({
            lsp: stubLspService(),
            path: 'a.luau',
            uri: 'file:///a.luau',
            getKnownPaths,
            openEditor: () => {},
            showUsages: () => {},
            getEngineApiDoc: () => null,
        })
        expect(calls).toBe(0)
        binding.dispose()
    })

    test('does not invoke getKnownPaths on subscribe / snapshot reads', () => {
        let calls = 0
        const getKnownPaths = () => {
            calls++
            return ['a.luau']
        }
        const binding = createLuauEditorBinding({
            lsp: stubLspService(),
            path: 'a.luau',
            uri: 'file:///a.luau',
            getKnownPaths,
            openEditor: () => {},
            showUsages: () => {},
            getEngineApiDoc: () => null,
        })
        const unsub = binding.subscribe(() => {})
        binding.getSnapshot()
        binding.getSnapshot()
        // Until something invokes URI resolution (goto-def), the getter
        // must stay untouched — otherwise the React layer's stable
        // callback identity buys nothing.
        expect(calls).toBe(0)
        unsub()
        binding.dispose()
    })
})
