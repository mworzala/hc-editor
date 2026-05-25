import { describe, expect, test } from 'bun:test'

import type { HCClient, MapFile } from '@hollowcube/api'

import { FileTreeService } from './FileTreeService'

function mapFile(over: Partial<MapFile> & Pick<MapFile, 'path'>): MapFile {
    return {
        contentType: 'text/plain',
        size: 0,
        hash: 'h',
        ...over,
    }
}

type FakeClient = {
    client: HCClient
    calls: { update: Array<{ path: string; body: string }>; delete: string[] }
    setNextUpdateError: (e: unknown) => void
    setNextDeleteError: (e: unknown) => void
    setNextUpdateResult: (file: MapFile) => void
}

function makeFakeClient(): FakeClient {
    const state = {
        nextUpdateError: null as unknown,
        nextDeleteError: null as unknown,
        nextUpdateResult: null as MapFile | null,
    }
    const calls = {
        update: [] as Array<{ path: string; body: string }>,
        delete: [] as string[],
    }
    const client = {
        v1: {
            map: {
                files: {},
            },
        },
        request: (method: string, path: string, opts?: { body?: string }) => {
            if (method === 'PUT') {
                calls.update.push({ path, body: String(opts?.body ?? '') })
                if (state.nextUpdateError !== null) {
                    const e = state.nextUpdateError
                    state.nextUpdateError = null
                    return Promise.reject(e)
                }
                return Promise.resolve(
                    (state.nextUpdateResult ?? mapFile({ path: extractFilePath(path) })) as unknown,
                )
            }
            return Promise.resolve(undefined as unknown)
        },
        send: (method: string, path: string) => {
            if (method === 'DELETE') {
                calls.delete.push(extractFilePath(path))
                if (state.nextDeleteError !== null) {
                    const e = state.nextDeleteError
                    state.nextDeleteError = null
                    return Promise.reject(e)
                }
                return Promise.resolve({
                    status: 204,
                    headers: new Headers(),
                } as unknown as Response)
            }
            return Promise.resolve(undefined as unknown as Response)
        },
    } as unknown as HCClient
    return {
        client,
        calls,
        setNextUpdateError: (e) => {
            state.nextUpdateError = e
        },
        setNextDeleteError: (e) => {
            state.nextDeleteError = e
        },
        setNextUpdateResult: (file) => {
            state.nextUpdateResult = file
        },
    }
}

// `/v1/map/{mapId}/files/{wildcard}` → strip prefix
function extractFilePath(reqPath: string): string {
    const idx = reqPath.indexOf('/files/')
    if (idx === -1) return reqPath
    return reqPath.slice(idx + '/files/'.length)
}

describe('FileTreeService — install / upsert / remove', () => {
    test('installAll seeds the flat map', () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' }), mapFile({ path: 'b.luau' })])
        expect(svc.files.peek().size).toBe(2)
        expect(svc.get('a.luau')?.path).toBe('a.luau')
    })

    test('list signal is sorted by path', () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'z.luau' }), mapFile({ path: 'a.luau' })])
        expect(svc.list.peek().map((f) => f.path)).toEqual(['a.luau', 'z.luau'])
    })

    test('upsert replaces existing entry', () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau', size: 1 })])
        svc.upsert(mapFile({ path: 'a.luau', size: 9 }))
        expect(svc.get('a.luau')?.size).toBe(9)
    })

    test('remove deletes by path', () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' })])
        svc.remove('a.luau')
        expect(svc.has('a.luau')).toBe(false)
    })
})

describe('FileTreeService — rename', () => {
    test('PUTs to newPath, DELETEs oldPath, repoints the flat map', async () => {
        const fake = makeFakeClient()
        fake.setNextUpdateResult(mapFile({ path: 'src/new.luau' }))
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'src/old.luau' })])
        const result = await svc.rename('src/old.luau', 'src/new.luau', 'hello')
        expect(result.ok).toBe(true)
        expect(svc.has('src/old.luau')).toBe(false)
        expect(svc.has('src/new.luau')).toBe(true)
        expect(fake.calls.update[0]?.path.endsWith('src/new.luau')).toBe(true)
        expect(fake.calls.delete[0]).toBe('src/old.luau')
    })

    test('returns `exists` error when newPath already in the map', async () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' }), mapFile({ path: 'b.luau' })])
        const result = await svc.rename('a.luau', 'b.luau', 'x')
        if (result.ok) throw new Error('expected error')
        expect(result.error.kind).toBe('exists')
    })

    test('returns `write` error when PUT fails; map untouched', async () => {
        const fake = makeFakeClient()
        fake.setNextUpdateError(new Error('boom'))
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' })])
        const result = await svc.rename('a.luau', 'b.luau', 'x')
        if (result.ok) throw new Error('expected error')
        expect(result.error.kind).toBe('write')
        expect(svc.has('a.luau')).toBe(true)
    })
})

describe('FileTreeService — delete', () => {
    test('removes from map after server confirms', async () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' })])
        const result = await svc.delete('a.luau')
        expect(result.ok).toBe(true)
        expect(svc.has('a.luau')).toBe(false)
    })

    test('returns `network` error and leaves map intact on server failure', async () => {
        const fake = makeFakeClient()
        fake.setNextDeleteError(new Error('offline'))
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' })])
        const result = await svc.delete('a.luau')
        if (result.ok) throw new Error('expected error')
        expect(result.error.kind).toBe('network')
        expect(svc.has('a.luau')).toBe(true)
    })
})

describe('FileTreeService — disposal', () => {
    test('clears the map', () => {
        const fake = makeFakeClient()
        const svc = new FileTreeService({ projectId: 'p1', client: fake.client })
        svc.installAll([mapFile({ path: 'a.luau' })])
        svc.dispose()
        expect(svc.files.peek().size).toBe(0)
    })
})
