import { describe, expect, test } from 'bun:test'

import { Emitter } from './emitter'

describe('Emitter — subscribe + fire', () => {
    test('delivers fired values to each subscribed listener', () => {
        const e = new Emitter<number>()
        const seenA: number[] = []
        const seenB: number[] = []
        e.event((v) => seenA.push(v))
        e.event((v) => seenB.push(v))
        e.fire(1)
        e.fire(2)
        expect(seenA).toEqual([1, 2])
        expect(seenB).toEqual([1, 2])
    })

    test('unsubscribe handle stops delivery', () => {
        const e = new Emitter<string>()
        const seen: string[] = []
        const off = e.event((v) => seen.push(v))
        e.fire('a')
        off()
        e.fire('b')
        expect(seen).toEqual(['a'])
    })

    test('unsubscribe is idempotent', () => {
        const e = new Emitter<void>()
        let count = 0
        const off = e.event(() => count++)
        off()
        off()
        e.fire()
        expect(count).toBe(0)
    })
})

describe('Emitter — robustness', () => {
    test('a throwing listener does not block subsequent listeners', () => {
        const e = new Emitter<number>()
        const seenAfter: number[] = []
        e.event(() => {
            throw new Error('boom')
        })
        e.event((v) => seenAfter.push(v))
        // Mute the console.error noise from the snapshot loop.
        const originalError = console.error
        console.error = () => {}
        try {
            e.fire(7)
        } finally {
            console.error = originalError
        }
        expect(seenAfter).toEqual([7])
    })

    test('a listener that unsubscribes itself during fire does not skip siblings', () => {
        const e = new Emitter<number>()
        const seen: string[] = []
        const offA = e.event((v) => {
            seen.push(`a:${v}`)
            offA()
        })
        e.event((v) => {
            seen.push(`b:${v}`)
        })
        e.fire(1)
        e.fire(2)
        expect(seen).toEqual(['a:1', 'b:1', 'b:2'])
    })

    test('a listener that subscribes a new listener during fire does not deliver to the new one until the next fire', () => {
        const e = new Emitter<number>()
        const seen: string[] = []
        e.event((v) => {
            seen.push(`a:${v}`)
            if (v === 1) {
                e.event((w) => seen.push(`new:${w}`))
            }
        })
        e.fire(1)
        e.fire(2)
        expect(seen).toEqual(['a:1', 'a:2', 'new:2'])
    })
})

describe('Emitter — disposal', () => {
    test('dispose clears listeners; subsequent fires are no-ops', () => {
        const e = new Emitter<number>()
        let count = 0
        e.event(() => count++)
        e.dispose()
        e.fire(1)
        expect(count).toBe(0)
    })

    test('event() after dispose still records listeners (caller error, but defined behavior)', () => {
        // Documenting current behavior: dispose() doesn't seal the emitter.
        // Callers shouldn't subscribe to a disposed emitter, but if they
        // do, the listener works until the next dispose. Tests pin this so
        // a future "seal on dispose" change is a conscious decision.
        const e = new Emitter<number>()
        e.dispose()
        const seen: number[] = []
        e.event((v) => seen.push(v))
        e.fire(5)
        expect(seen).toEqual([5])
    })
})
