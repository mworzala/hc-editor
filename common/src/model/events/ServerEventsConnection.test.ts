import { describe, expect, test } from 'bun:test'

import type { HCClient, MapEventEnvelope, MapFile } from '@hollowcube/api'

import { FileTreeService } from '../files/FileTreeService'
import { PendingFilesService } from '../files/PendingFilesService'
import { LspService } from '../lsp/LspService'
import { makeTestCollaborators } from '../test-helpers'
import { TextModelService } from '../text-models/TextModelService'
import { ServerEventsConnection, type EventsStreamFactory } from './ServerEventsConnection'

function mapFile(path: string): MapFile {
    return { path, contentType: 'text/plain', size: 0, hash: 'h' }
}

type Fakes = {
    fileTreeRefreshCalls: number
    fetchedPaths: string[]
    bytesByPath: Map<string, Uint8Array>
}

type Harness = {
    fakes: Fakes
    fileTree: FileTreeService
    textModels: TextModelService
    lsp: LspService
    pendingFiles: PendingFilesService
    collaborators: ReturnType<typeof makeTestCollaborators>
}

function makeHarness(): Harness {
    const fakes: Fakes = {
        fileTreeRefreshCalls: 0,
        fetchedPaths: [],
        bytesByPath: new Map(),
    }
    const client = {} as HCClient
    const collaborators = makeTestCollaborators()
    const fileTree = new FileTreeService({ projectId: 'p1', client })
    // Patch refresh to count calls.
    fileTree.refresh = () => {
        fakes.fileTreeRefreshCalls++
        return Promise.resolve()
    }
    const pendingFiles = new PendingFilesService()
    const textModels = new TextModelService({
        projectId: 'p1',
        client,
        fileTree,
        pendingFiles,
        actions: collaborators.actions,
        activeEditor: collaborators.activeEditor,
        layout: collaborators.layout,
        dialogs: collaborators.dialogs,
    })
    const lsp = new LspService({
        textModels,
        context: collaborators.context,
        search: collaborators.search,
        actions: collaborators.actions,
        activeEditor: collaborators.activeEditor,
    })
    return { fakes, fileTree, textModels, lsp, pendingFiles, collaborators }
}

function disposeHarness(h: Harness) {
    h.lsp.dispose()
    h.textModels.dispose()
    h.pendingFiles.dispose()
    h.fileTree.dispose()
    h.collaborators.dispose()
}

function pushEvents(events: MapEventEnvelope[]): {
    factory: EventsStreamFactory
    close: () => void
} {
    let closed = false
    const factory: EventsStreamFactory = async function* () {
        for (const e of events) {
            if (closed) return
            yield e
            // Microtask break so awaiters see each event.
            await Promise.resolve()
        }
        // After yielding all events, stay open until aborted.
        // eslint-disable-next-line no-unmodified-loop-condition -- closed is flipped by the close() callback
        while (!closed) {
            await new Promise((r) => setTimeout(r, 5))
        }
    }
    return {
        factory,
        close: () => {
            closed = true
        },
    }
}

describe('ServerEventsConnection — connect + status', () => {
    test('starts in connecting, then connected', async () => {
        const h = makeHarness()
        const { factory, close } = pushEvents([])
        const conn = new ServerEventsConnection({
            projectId: 'p1',
            client: {} as HCClient,
            fileTree: h.fileTree,
            textModels: h.textModels,
            lsp: h.lsp,
            streamFactory: factory,
        })
        // Microtask break for the async generator to start.
        await Promise.resolve()
        await Promise.resolve()
        expect(['connecting', 'connected']).toContain(conn.status.peek())
        close()
        conn.dispose()
        disposeHarness(h)
    })
})

describe('ServerEventsConnection — apply event', () => {
    test('calls fileTree.refresh on each event', async () => {
        const h = makeHarness()
        const { factory, close } = pushEvents([
            { id: '1', path: 'a.luau' },
            { id: '2', path: 'b.luau' },
        ])
        const conn = new ServerEventsConnection({
            projectId: 'p1',
            client: {} as HCClient,
            fileTree: h.fileTree,
            textModels: h.textModels,
            lsp: h.lsp,
            streamFactory: factory,
            // No file is open in TextModels, so fetchBytes won't be called.
            fetchBytes: () => Promise.reject(new Error('should not be called')),
        })
        // Let the events drain.
        await new Promise((r) => setTimeout(r, 30))
        expect(h.fakes.fileTreeRefreshCalls).toBeGreaterThanOrEqual(2)
        expect(conn.lastEventId.peek()).toBe('2')
        close()
        conn.dispose()
        disposeHarness(h)
    })

    test('targeted handleExternalChange on a clean open model', async () => {
        const h = makeHarness()
        h.fileTree.installAll([mapFile('a.luau')])
        h.textModels.getOrOpen('a.luau', 'original')
        const { factory, close } = pushEvents([{ id: '1', path: 'a.luau' }])
        let fetchCalled = false
        const conn = new ServerEventsConnection({
            projectId: 'p1',
            client: {} as HCClient,
            fileTree: h.fileTree,
            textModels: h.textModels,
            lsp: h.lsp,
            streamFactory: factory,
            fetchBytes: () => {
                fetchCalled = true
                return Promise.resolve({
                    bytes: new TextEncoder().encode('updated'),
                    contentType: 'text/plain',
                })
            },
        })
        await new Promise((r) => setTimeout(r, 50))
        expect(fetchCalled).toBe(true)
        const model = h.textModels.get('a.luau')
        expect(model?.content.peek()).toBe('updated')
        close()
        conn.dispose()
        disposeHarness(h)
    })

    test('dirty model is left untouched', async () => {
        const h = makeHarness()
        h.fileTree.installAll([mapFile('a.luau')])
        const model = h.textModels.getOrOpen('a.luau', 'original')
        model.setContent('local edit')
        const { factory, close } = pushEvents([{ id: '1', path: 'a.luau' }])
        let fetchCalled = false
        const conn = new ServerEventsConnection({
            projectId: 'p1',
            client: {} as HCClient,
            fileTree: h.fileTree,
            textModels: h.textModels,
            lsp: h.lsp,
            streamFactory: factory,
            fetchBytes: () => {
                fetchCalled = true
                return Promise.resolve({
                    bytes: new TextEncoder().encode('remote'),
                    contentType: 'text/plain',
                })
            },
        })
        await new Promise((r) => setTimeout(r, 30))
        expect(fetchCalled).toBe(false)
        expect(model.content.peek()).toBe('local edit')
        close()
        conn.dispose()
        disposeHarness(h)
    })
})

describe('ServerEventsConnection — disposal', () => {
    test('dispose aborts the stream cleanly', async () => {
        const h = makeHarness()
        const { factory, close } = pushEvents([])
        const conn = new ServerEventsConnection({
            projectId: 'p1',
            client: {} as HCClient,
            fileTree: h.fileTree,
            textModels: h.textModels,
            lsp: h.lsp,
            streamFactory: factory,
        })
        await Promise.resolve()
        conn.dispose()
        // Wait briefly so any pending microtasks settle.
        await new Promise((r) => setTimeout(r, 10))
        close()
        disposeHarness(h)
    })
})
