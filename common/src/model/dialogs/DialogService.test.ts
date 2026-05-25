import { describe, expect, test } from 'bun:test'

import { DialogService } from './DialogService'

describe('DialogService — savePath', () => {
    test('opening sets active to a savePath state', () => {
        const svc = new DialogService()
        void svc.savePath({ suggested: 'foo.txt' })
        const active = svc.active.peek()
        expect(active?.kind).toBe('savePath')
        if (active?.kind !== 'savePath') throw new Error('unreachable')
        expect(active.suggested).toBe('foo.txt')
    })

    test('confirm resolves the promise with the path and clears active', async () => {
        const svc = new DialogService()
        const p = svc.savePath({ suggested: 'a.txt' })
        const active = svc.active.peek()
        if (active?.kind !== 'savePath') throw new Error('not open')
        active.confirm('chosen.txt')
        const result = await p
        expect(result).toBe('chosen.txt')
        expect(svc.active.peek()).toBeNull()
    })

    test('cancel resolves the promise with null and clears active', async () => {
        const svc = new DialogService()
        const p = svc.savePath({ suggested: 'a.txt' })
        const active = svc.active.peek()
        if (active?.kind !== 'savePath') throw new Error('not open')
        active.cancel()
        const result = await p
        expect(result).toBeNull()
        expect(svc.active.peek()).toBeNull()
    })

    test('opening a second dialog cancels the first (resolves null)', async () => {
        const svc = new DialogService()
        const first = svc.savePath({ suggested: 'a.txt' })
        const second = svc.savePath({ suggested: 'b.txt' })
        const firstResult = await first
        expect(firstResult).toBeNull()
        const active = svc.active.peek()
        if (active?.kind !== 'savePath') throw new Error('not open')
        expect(active.suggested).toBe('b.txt')
        active.confirm('done.txt')
        expect(await second).toBe('done.txt')
    })

    test('closeActive cancels the current dialog', async () => {
        const svc = new DialogService()
        const p = svc.savePath({ suggested: 'x.txt' })
        svc.closeActive()
        expect(await p).toBeNull()
        expect(svc.active.peek()).toBeNull()
    })

    test('dispose cancels any open dialog', async () => {
        const svc = new DialogService()
        const p = svc.savePath({ suggested: 'x.txt' })
        svc.dispose()
        expect(await p).toBeNull()
        expect(svc.active.peek()).toBeNull()
    })
})
