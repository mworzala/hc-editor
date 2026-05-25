import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { HCClient } from '@hollowcube/api'

import { FileTreeService } from '../files/FileTreeService'
import { PendingFilesService } from '../files/PendingFilesService'
import { makeTestCollaborators } from '../test-helpers'
import { TextModelService } from '../text-models/TextModelService'
import { LspService } from './LspService'

// LspService.start() spawns a real Worker + LspClient; that path is
// integration-tested via the preview smoke. The unit tests here cover
// the service's signal layer, context-key derivations, search-source
// registration, and disposal — i.e. the parts that exist before
// `start()` is called.

const fakeClient = {} as HCClient

let collaborators: ReturnType<typeof makeTestCollaborators>
let fileTree: FileTreeService
let pendingFiles: PendingFilesService
let textModels: TextModelService

function deps() {
    return {
        textModels,
        context: collaborators.context,
        search: collaborators.search,
        actions: collaborators.actions,
        activeEditor: collaborators.activeEditor,
    }
}

beforeEach(() => {
    collaborators = makeTestCollaborators()
    fileTree = new FileTreeService({ projectId: 'p1', client: fakeClient })
    pendingFiles = new PendingFilesService()
    textModels = new TextModelService({
        projectId: 'p1',
        client: fakeClient,
        fileTree,
        pendingFiles,
        actions: collaborators.actions,
        activeEditor: collaborators.activeEditor,
        layout: collaborators.layout,
        dialogs: collaborators.dialogs,
    })
})

afterEach(() => {
    textModels.dispose()
    pendingFiles.dispose()
    fileTree.dispose()
    collaborators.dispose()
})

describe('LspService — initial state', () => {
    test('starts in `stopped` with no client', () => {
        const svc = new LspService(deps())
        expect(svc.status.peek()).toBe('stopped')
        expect(svc.client.peek()).toBeNull()
        svc.dispose()
    })

    test('registers a `symbols` search source on construction', () => {
        const svc = new LspService(deps())
        expect(collaborators.search.get('symbols')?.title).toBe('Symbols')
        svc.dispose()
    })
})

describe('LspService — context keys', () => {
    test('`lsp.luau.*` keys reflect status', () => {
        const svc = new LspService(deps())
        const { context } = collaborators
        expect(context.evaluate('lsp.luau.running')).toBe(false)
        expect(context.evaluate('lsp.luau.starting')).toBe(false)
        expect(context.evaluate('lsp.luau.failed')).toBe(false)
        svc.dispose()
    })
})

describe('LspService — diagnosticsForUri', () => {
    test('returns a stable signal per URI; identical URIs share the signal', () => {
        const svc = new LspService(deps())
        const a = svc.diagnosticsForUri('file:///a.luau')
        const b = svc.diagnosticsForUri('file:///a.luau')
        expect(a).toBe(b)
        expect(a.peek()).toEqual([])
        svc.dispose()
    })

    test('different URIs get distinct signals', () => {
        const svc = new LspService(deps())
        const a = svc.diagnosticsForUri('file:///a.luau')
        const b = svc.diagnosticsForUri('file:///b.luau')
        expect(a).not.toBe(b)
        svc.dispose()
    })
})

describe('LspService — errorCountByPath', () => {
    test('empty when no diagnostics tracked', () => {
        const svc = new LspService(deps())
        expect(svc.errorCountByPath.peek().size).toBe(0)
        svc.dispose()
    })
})

describe('LspService — disposal', () => {
    test('dispose clears context-key derivations and unregisters search source', () => {
        const svc = new LspService(deps())
        expect(collaborators.search.get('symbols')).toBeDefined()
        svc.dispose()
        expect(collaborators.search.get('symbols')).toBeUndefined()
        // Context keys read as undefined (falsy) post-dispose.
        expect(collaborators.context.evaluate('lsp.luau.running')).toBe(false)
    })

    test('dispose is idempotent', () => {
        const svc = new LspService(deps())
        svc.dispose()
        svc.dispose()
    })
})
