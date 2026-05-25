import { describe, expect, test } from 'bun:test'

import type { EngineApiBundle } from '../../engine-api/bundle'
import { EngineApiService } from './EngineApiService'

function makeBundle(): EngineApiBundle {
    return {
        doc: {
            libraries: {},
            globals: [],
            // The schema has more fields; the tests only inspect bundle.doc
            // identity. Cast through unknown to avoid carrying every shape.
        } as unknown as EngineApiBundle['doc'],
        docModules: [],
        docModuleAliases: {},
        definitionFiles: [],
    }
}

function defer<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('EngineApiService — state machine', () => {
    test('starts in idle', () => {
        const svc = new EngineApiService({ load: () => Promise.resolve(makeBundle()) })
        expect(svc.status.peek().kind).toBe('idle')
        expect(svc.bundle.peek()).toBeNull()
        svc.dispose()
    })

    test('start() transitions idle → loading → ready', async () => {
        const d = defer<EngineApiBundle>()
        const svc = new EngineApiService({ load: () => d.promise })
        svc.start()
        expect(svc.status.peek().kind).toBe('loading')
        const bundle = makeBundle()
        d.resolve(bundle)
        await Promise.resolve()
        await Promise.resolve()
        const s = svc.status.peek()
        if (s.kind !== 'ready') throw new Error(`expected ready, got ${s.kind}`)
        expect(s.bundle).toBe(bundle)
        expect(svc.bundle.peek()).toBe(bundle)
        svc.dispose()
    })

    test('start() transitions to error on load failure', async () => {
        const d = defer<EngineApiBundle>()
        const svc = new EngineApiService({ load: () => d.promise })
        // Mute the error console.
        const orig = console.error
        console.error = () => {}
        try {
            svc.start()
            const err = new Error('boom')
            d.reject(err)
            await Promise.resolve()
            await Promise.resolve()
            const s = svc.status.peek()
            if (s.kind !== 'error') throw new Error('expected error')
            expect(s.error).toBe(err)
        } finally {
            console.error = orig
            svc.dispose()
        }
    })

    test('start() is a no-op when already ready', async () => {
        let loadCount = 0
        const svc = new EngineApiService({
            load: () => {
                loadCount++
                return Promise.resolve(makeBundle())
            },
        })
        svc.start()
        await Promise.resolve()
        await Promise.resolve()
        expect(svc.status.peek().kind).toBe('ready')
        svc.start()
        expect(loadCount).toBe(1)
        svc.dispose()
    })

    test('start() retries from error state', async () => {
        let attempt = 0
        const svc = new EngineApiService({
            load: () => {
                attempt++
                return attempt === 1
                    ? Promise.reject(new Error('boom'))
                    : Promise.resolve(makeBundle())
            },
        })
        const orig = console.error
        console.error = () => {}
        try {
            svc.start()
            await Promise.resolve()
            await Promise.resolve()
            expect(svc.status.peek().kind).toBe('error')
            svc.start()
            await Promise.resolve()
            await Promise.resolve()
            expect(svc.status.peek().kind).toBe('ready')
            expect(attempt).toBe(2)
        } finally {
            console.error = orig
            svc.dispose()
        }
    })
})

describe('EngineApiService — lookup', () => {
    test('returns undefined when bundle not ready', () => {
        const svc = new EngineApiService({ load: () => Promise.resolve(makeBundle()) })
        expect(svc.lookup('Text')).toBeUndefined()
        svc.dispose()
    })

    test('delegates to findDocNode after ready', async () => {
        const bundle: EngineApiBundle = {
            doc: {
                libraries: { '@mapmaker/store': { moduleName: 'store' } } as unknown,
                globals: [{ moduleName: 'Text' } as unknown],
            } as unknown as EngineApiBundle['doc'],
            docModules: [],
            docModuleAliases: {},
            definitionFiles: [],
        }
        const svc = new EngineApiService({ load: () => Promise.resolve(bundle) })
        svc.start()
        await Promise.resolve()
        await Promise.resolve()
        expect(svc.lookup('@mapmaker/store')).toBeDefined()
        expect(svc.lookup('Text')).toBeDefined()
        expect(svc.lookup('missing')).toBeUndefined()
        svc.dispose()
    })
})

describe('EngineApiService — disposal', () => {
    test('dispose stops further state transitions', async () => {
        const d = defer<EngineApiBundle>()
        const svc = new EngineApiService({ load: () => d.promise })
        svc.start()
        svc.dispose()
        d.resolve(makeBundle())
        await Promise.resolve()
        await Promise.resolve()
        // dispose resets to idle and the late resolve is ignored.
        expect(svc.status.peek().kind).toBe('idle')
    })
})
