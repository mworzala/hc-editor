import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { HCClient, MapEditorBootstrap, MapFile } from '@hollowcube/api'

import type { Platform } from '../../platform'
import { FileTreeService } from '../files/FileTreeService'
import { ProjectBootstrap } from './ProjectBootstrap'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }
function defer<T>(): Deferred<T> {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

function mapFile(path: string): MapFile {
    return { path, contentType: 'text/plain', size: 0, hash: 'h' }
}

function makeBootstrap(): MapEditorBootstrap {
    return {
        map: { id: 'p1', name: 'Demo', owner: 'me' },
        files: [mapFile('a.luau'), mapFile('b.luau')],
    }
}

type FakeClient = {
    client: HCClient
    next: Deferred<MapEditorBootstrap>
    arm: () => Deferred<MapEditorBootstrap>
}

function makeFakeClient(): FakeClient {
    let pending: Deferred<MapEditorBootstrap> | null = null
    const arm = () => {
        pending = defer<MapEditorBootstrap>()
        return pending
    }
    const client = {
        request: (_method: string, _path: string, opts?: { signal?: AbortSignal }) => {
            if (!pending) throw new Error('bootstrap not armed')
            const p = pending
            // Reject if the caller aborts.
            opts?.signal?.addEventListener(
                'abort',
                () => p.reject(new DOMException('aborted', 'AbortError')),
                { once: true },
            )
            return p.promise
        },
    } as unknown as HCClient
    arm()
    return {
        client,
        get next() {
            if (!pending) throw new Error('unreachable')
            return pending
        },
        arm,
    }
}

function makePlatform(): { platform: Platform; titles: string[] } {
    const titles: string[] = []
    const platform: Platform = {
        kind: 'web',
        storage: { get: () => null, set: () => {}, remove: () => {} },
        setWindowTitle: (t) => titles.push(t),
    }
    return { platform, titles }
}

let fake: FakeClient
let fileTree: FileTreeService
let platform: ReturnType<typeof makePlatform>

beforeEach(() => {
    fake = makeFakeClient()
    fileTree = new FileTreeService({ projectId: 'p1', client: fake.client })
    platform = makePlatform()
})

afterEach(() => {
    fileTree.dispose()
})

describe('ProjectBootstrap — lifecycle', () => {
    test('starts in `idle`', () => {
        const bootstrap = new ProjectBootstrap({
            projectId: 'p1',
            client: fake.client,
            platform: platform.platform,
            fileTree,
        })
        expect(bootstrap.status.peek().kind).toBe('idle')
        expect(bootstrap.project.peek()).toBeNull()
        bootstrap.dispose()
    })

    test('start() transitions to `loading` then `loaded`; installs files; sets title', async () => {
        const bootstrap = new ProjectBootstrap({
            projectId: 'p1',
            client: fake.client,
            platform: platform.platform,
            fileTree,
        })
        bootstrap.start()
        expect(bootstrap.status.peek().kind).toBe('loading')
        fake.next.resolve(makeBootstrap())
        await Promise.resolve()
        await Promise.resolve()
        expect(bootstrap.status.peek().kind).toBe('loaded')
        expect(bootstrap.project.peek()?.name).toBe('Demo')
        expect(fileTree.files.peek().size).toBe(2)
        expect(platform.titles).toEqual(['Demo'])
        bootstrap.dispose()
    })

    test('start() on `error` produces `error` state with the cause', async () => {
        const bootstrap = new ProjectBootstrap({
            projectId: 'p1',
            client: fake.client,
            platform: platform.platform,
            fileTree,
        })
        bootstrap.start()
        const err = new Error('boom')
        fake.next.reject(err)
        await Promise.resolve()
        await Promise.resolve()
        const s = bootstrap.status.peek()
        if (s.kind !== 'error') throw new Error('expected error')
        expect(s.error).toBe(err)
        bootstrap.dispose()
    })

    test('start() is a no-op when already loaded', async () => {
        const bootstrap = new ProjectBootstrap({
            projectId: 'p1',
            client: fake.client,
            platform: platform.platform,
            fileTree,
        })
        bootstrap.start()
        fake.next.resolve(makeBootstrap())
        await Promise.resolve()
        await Promise.resolve()
        expect(bootstrap.status.peek().kind).toBe('loaded')
        bootstrap.start()
        expect(bootstrap.status.peek().kind).toBe('loaded')
        bootstrap.dispose()
    })

    test('retry() transitions to loading and refetches', async () => {
        const bootstrap = new ProjectBootstrap({
            projectId: 'p1',
            client: fake.client,
            platform: platform.platform,
            fileTree,
        })
        bootstrap.start()
        fake.next.reject(new Error('boom'))
        await Promise.resolve()
        await Promise.resolve()
        expect(bootstrap.status.peek().kind).toBe('error')

        fake.arm()
        bootstrap.retry()
        expect(bootstrap.status.peek().kind).toBe('loading')
        fake.next.resolve(makeBootstrap())
        await Promise.resolve()
        await Promise.resolve()
        expect(bootstrap.status.peek().kind).toBe('loaded')
        bootstrap.dispose()
    })

    test('dispose aborts the in-flight fetch; no state transition after abort', async () => {
        const bootstrap = new ProjectBootstrap({
            projectId: 'p1',
            client: fake.client,
            platform: platform.platform,
            fileTree,
        })
        bootstrap.start()
        bootstrap.dispose()
        // Resolving after dispose should not change state.
        fake.next.resolve(makeBootstrap())
        await Promise.resolve()
        await Promise.resolve()
        expect(bootstrap.status.peek().kind).toBe('loading')
    })
})
