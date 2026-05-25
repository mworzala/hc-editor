import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { HCClient, MapFile } from '@hollowcube/api'

import { makeTestCollaborators } from '../test-helpers'
import { TextModelService } from '../text-models/TextModelService'
import { FileOperationsService } from './FileOperationsService'
import { FileTreeService } from './FileTreeService'
import { PendingFilesService } from './PendingFilesService'

function mapFile(path: string, size = 1): MapFile {
    return { path, contentType: 'text/plain', size, hash: 'h' }
}

type FakeClient = {
    client: HCClient
    calls: { put: Array<{ path: string; body: string }>; delete: string[]; get: string[] }
    setNextGet: (bytes: Uint8Array, contentType?: string) => void
    setNextPutError: (e: unknown) => void
}

function makeFakeClient(): FakeClient {
    const state = {
        nextGet: null as { bytes: Uint8Array; contentType: string } | null,
        nextPutError: null as unknown,
    }
    const calls = {
        put: [] as Array<{ path: string; body: string }>,
        delete: [] as string[],
        get: [] as string[],
    }
    const client = {
        request: (method: string, path: string, opts?: { body?: string }) => {
            const filePath = extractFilePath(path)
            if (method === 'PUT') {
                calls.put.push({ path: filePath, body: String(opts?.body ?? '') })
                if (state.nextPutError !== null) {
                    const e = state.nextPutError
                    state.nextPutError = null
                    return Promise.reject(e)
                }
                return Promise.resolve(
                    mapFile(filePath, String(opts?.body ?? '').length) as unknown,
                )
            }
            return Promise.resolve(undefined as unknown)
        },
        send: (method: string, path: string) => {
            const filePath = extractFilePath(path)
            if (method === 'DELETE') {
                calls.delete.push(filePath)
                return Promise.resolve({
                    status: 204,
                    headers: new Headers(),
                } as unknown as Response)
            }
            if (method === 'GET') {
                calls.get.push(filePath)
                const data = state.nextGet ?? {
                    bytes: new TextEncoder().encode(''),
                    contentType: 'text/plain',
                }
                state.nextGet = null
                const ab = data.bytes.slice().buffer
                const blob = new Blob([ab], { type: data.contentType })
                return Promise.resolve(
                    new Response(blob, {
                        headers: new Headers({ 'content-type': data.contentType }),
                    }),
                )
            }
            return Promise.resolve(new Response(null))
        },
    } as unknown as HCClient
    return {
        client,
        calls,
        setNextGet: (bytes, contentType = 'text/plain') => {
            state.nextGet = { bytes, contentType }
        },
        setNextPutError: (e) => {
            state.nextPutError = e
        },
    }
}

function extractFilePath(reqPath: string): string {
    const idx = reqPath.indexOf('/files/')
    if (idx === -1) return reqPath
    return reqPath.slice(idx + '/files/'.length)
}

let fake: FakeClient
let fileTree: FileTreeService
let pendingFiles: PendingFilesService
let textModels: TextModelService
let collaborators: ReturnType<typeof makeTestCollaborators>
let fileOps: FileOperationsService

beforeEach(() => {
    fake = makeFakeClient()
    fileTree = new FileTreeService({ projectId: 'p1', client: fake.client })
    pendingFiles = new PendingFilesService()
    collaborators = makeTestCollaborators()
    textModels = new TextModelService({
        projectId: 'p1',
        client: fake.client,
        fileTree,
        pendingFiles,
        actions: collaborators.actions,
        activeEditor: collaborators.activeEditor,
        layout: collaborators.layout,
        dialogs: collaborators.dialogs,
    })
    fileOps = new FileOperationsService({
        projectId: 'p1',
        client: fake.client,
        fileTree,
        pendingFiles,
        textModels,
        layout: collaborators.layout,
    })
})

afterEach(() => {
    textModels.dispose()
    fileTree.dispose()
    pendingFiles.dispose()
    collaborators.dispose()
})

describe('FileOperationsService — move (pending)', () => {
    test('pending source: just reassigns the path on the pending entry', async () => {
        const tempId = pendingFiles.addAtPath('drafts/a.txt')
        const result = await fileOps.move(`pending:${tempId}`, 'drafts/b.txt')
        expect(result.ok).toBe(true)
        expect(pendingFiles.get(tempId)?.path).toBe('drafts/b.txt')
        expect(fake.calls.put).toEqual([])
        expect(fake.calls.delete).toEqual([])
    })
})

describe('FileOperationsService — move (real)', () => {
    test('saved file with no open model: GET old, PUT new, DELETE old', async () => {
        fileTree.installAll([mapFile('a.luau')])
        fake.setNextGet(new TextEncoder().encode('server-content'))
        const result = await fileOps.move('a.luau', 'b.luau')
        expect(result.ok).toBe(true)
        expect(fake.calls.get).toEqual(['a.luau'])
        expect(fake.calls.put[0]?.body).toBe('server-content')
        expect(fake.calls.delete).toEqual(['a.luau'])
        expect(fileTree.has('a.luau')).toBe(false)
        expect(fileTree.has('b.luau')).toBe(true)
    })

    test('saved file with open dirty model: uses in-memory content (no GET)', async () => {
        fileTree.installAll([mapFile('a.luau')])
        const m = textModels.getOrOpen('a.luau', 'orig')
        m.setContent('dirty edits')
        const result = await fileOps.move('a.luau', 'b.luau')
        expect(result.ok).toBe(true)
        expect(fake.calls.get).toEqual([])
        expect(fake.calls.put[0]?.body).toBe('dirty edits')
        // TextModel was rekeyed by handleRename
        expect(textModels.get('b.luau')).toBeDefined()
        expect(textModels.get('a.luau')).toBeUndefined()
    })

    test('newPath already exists → returns exists error, no writes', async () => {
        fileTree.installAll([mapFile('a.luau'), mapFile('b.luau')])
        const result = await fileOps.move('a.luau', 'b.luau')
        expect(result.ok).toBe(false)
        if (result.ok) throw new Error('unreachable')
        expect(result.error.kind).toBe('exists')
        expect(fake.calls.put).toEqual([])
        expect(fake.calls.delete).toEqual([])
    })

    test('write failure surfaces error', async () => {
        fileTree.installAll([mapFile('a.luau')])
        const m = textModels.getOrOpen('a.luau', 'orig')
        m.setContent('content')
        fake.setNextPutError(new Error('boom'))
        const result = await fileOps.move('a.luau', 'b.luau')
        expect(result.ok).toBe(false)
        if (result.ok) throw new Error('unreachable')
        expect(result.error.kind).toBe('write')
    })

    test('repoints open editor tabs from oldPath to newPath', async () => {
        fileTree.installAll([mapFile('a.luau')])
        const m = textModels.getOrOpen('a.luau', 'orig')
        m.setContent('content')
        collaborators.layout.addTab(
            { kind: 'editor', leafId: 'leaf-1' },
            { id: 'tab-1', kind: 'editor:text', title: 'a.luau', payload: { path: 'a.luau' } },
        )
        const result = await fileOps.move('a.luau', 'sub/b.luau')
        expect(result.ok).toBe(true)
        const center = collaborators.layout.center.peek()
        if (center.kind !== 'leaf') throw new Error('expected leaf')
        const tab = center.tabs[0]
        expect((tab?.payload as { path?: string })?.path).toBe('sub/b.luau')
        expect(tab?.title).toBe('b.luau')
    })

    test('same source and target: no-op', async () => {
        fileTree.installAll([mapFile('a.luau')])
        const result = await fileOps.move('a.luau', 'a.luau')
        expect(result.ok).toBe(true)
        expect(fake.calls.put).toEqual([])
        expect(fake.calls.delete).toEqual([])
    })
})

describe('FileOperationsService — delete', () => {
    test('closes matching editor tabs before issuing the server delete', async () => {
        fileTree.installAll([mapFile('a.luau')])
        collaborators.layout.addTab(
            { kind: 'editor', leafId: 'leaf-1' },
            { id: 'tab-1', kind: 'editor:text', title: 'a.luau', payload: { path: 'a.luau' } },
        )
        const result = await fileOps.delete('a.luau')
        expect(result.ok).toBe(true)
        const center = collaborators.layout.center.peek()
        if (center.kind !== 'leaf') throw new Error('expected leaf')
        expect(center.tabs).toHaveLength(0)
        expect(fake.calls.delete).toEqual(['a.luau'])
    })

    test('closes every tab beneath a folder-style delete prefix', async () => {
        fileTree.installAll([mapFile('src/a.luau'), mapFile('src/b.luau')])
        collaborators.layout.addTab(
            { kind: 'editor', leafId: 'leaf-1' },
            { id: 't1', kind: 'editor:text', title: 'a', payload: { path: 'src/a.luau' } },
        )
        collaborators.layout.addTab(
            { kind: 'editor', leafId: 'leaf-1' },
            { id: 't2', kind: 'editor:text', title: 'b', payload: { path: 'src/b.luau' } },
        )
        await fileOps.delete('src')
        const center = collaborators.layout.center.peek()
        if (center.kind !== 'leaf') throw new Error('expected leaf')
        expect(center.tabs).toHaveLength(0)
    })
})
