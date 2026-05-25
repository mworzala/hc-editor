import { beforeEach, describe, expect, test } from 'bun:test'

import { computed, effect, signal } from '../foundation/signal'
import { ContextService } from './ContextService'

let ctx: ContextService

beforeEach(() => {
    ctx = new ContextService()
})

describe('ContextService — set + get', () => {
    test('unknown key reads as undefined', () => {
        expect(ctx.get('missing')).toBeUndefined()
    })

    test('set then get returns latest value', () => {
        ctx.set('a', true)
        expect(ctx.get('a')).toBe(true)
        ctx.set('a', false)
        expect(ctx.get('a')).toBe(false)
    })

    test('set accepts arbitrary value types', () => {
        ctx.set('mode', 'edit')
        ctx.set('count', 5)
        expect(ctx.get('mode')).toBe('edit')
        expect(ctx.get('count')).toBe(5)
    })
})

describe('ContextService — derive', () => {
    test('derived key reflects current value of upstream signal', () => {
        const upstream = signal(0)
        ctx.derive('isPositive', () => upstream.value > 0)
        expect(ctx.get('isPositive')).toBe(false)
        upstream.value = 5
        expect(ctx.get('isPositive')).toBe(true)
    })

    test('derive auto-tracks its function via computed', () => {
        const a = signal(1)
        const b = signal(2)
        let runs = 0
        ctx.derive('sum', () => {
            runs++
            return a.value + b.value
        })
        // computed is lazy — force a read.
        expect(ctx.get('sum')).toBe(3)
        const baseline = runs
        a.value = 10
        expect(ctx.get('sum')).toBe(12)
        expect(runs).toBeGreaterThan(baseline)
    })

    test('derive dispose stops the key from updating; last value is retained', () => {
        // A consumer that already subscribed should not lose its latched
        // backing signal when the derivation is disposed — the architectural
        // intent is just "stop tracking this upstream", not "purge the value".
        const upstream = signal(1)
        const off = ctx.derive('x', () => upstream.value)
        expect(ctx.get('x')).toBe(1)
        off()
        upstream.value = 99
        // Derivation no longer mirrors; last value remains.
        expect(ctx.get('x')).toBe(1)
    })

    test('re-deriving the same key replaces the prior derivation', () => {
        ctx.derive('x', () => 'first')
        expect(ctx.get('x')).toBe('first')
        ctx.derive('x', () => 'second')
        expect(ctx.get('x')).toBe('second')
    })
})

describe('ContextService — evaluate', () => {
    test('empty / undefined when-clause evaluates to true (no guard)', () => {
        expect(ctx.evaluate(undefined)).toBe(true)
        expect(ctx.evaluate('')).toBe(true)
    })

    test('evaluates against set keys', () => {
        ctx.set('a', true)
        ctx.set('b', false)
        expect(ctx.evaluate('a')).toBe(true)
        expect(ctx.evaluate('b')).toBe(false)
        expect(ctx.evaluate('a && !b')).toBe(true)
        expect(ctx.evaluate('a && b')).toBe(false)
    })

    test('evaluates against derived keys', () => {
        const x = signal(0)
        ctx.derive('positive', () => x.value > 0)
        expect(ctx.evaluate('positive')).toBe(false)
        x.value = 1
        expect(ctx.evaluate('positive')).toBe(true)
    })

    test('string equality against a key', () => {
        ctx.set('mode', 'edit')
        expect(ctx.evaluate("mode === 'edit'")).toBe(true)
        expect(ctx.evaluate("mode === 'view'")).toBe(false)
    })

    test('caches parsed ASTs (no observable behavior, but parses once)', () => {
        ctx.set('a', true)
        for (let i = 0; i < 10; i++) {
            expect(ctx.evaluate('a')).toBe(true)
        }
    })
})

describe('ContextService — reactivity', () => {
    test('a computed wrapping evaluate() re-runs when a referenced set-key changes', () => {
        let runs = 0
        const c = computed(() => {
            runs++
            return ctx.evaluate('a && b')
        })
        // force registration
        expect(c.value).toBe(false)
        const baseline = runs
        ctx.set('a', true)
        ctx.set('b', true)
        expect(c.value).toBe(true)
        expect(runs).toBeGreaterThan(baseline)
    })

    test('changing an unrelated key does not re-run the computed', () => {
        ctx.set('a', true)
        ctx.set('b', true)
        ctx.set('c', false)
        let runs = 0
        const c = computed(() => {
            runs++
            return ctx.evaluate('a && b')
        })
        expect(c.value).toBe(true)
        const baseline = runs
        ctx.set('c', true)
        // accessing the computed shouldn't have re-run it (no dep on c)
        expect(c.value).toBe(true)
        expect(runs).toBe(baseline)
    })

    test('an effect over evaluate() fires on key changes', () => {
        const fires: boolean[] = []
        const dispose = effect(() => {
            fires.push(ctx.evaluate('a'))
        })
        // initial run
        expect(fires).toEqual([false])
        ctx.set('a', true)
        expect(fires).toEqual([false, true])
        ctx.set('a', false)
        expect(fires).toEqual([false, true, false])
        dispose()
    })
})

describe('ContextService — disposal', () => {
    test('dispose clears all keys and derivations', () => {
        ctx.set('a', true)
        ctx.derive('b', () => true)
        ctx.dispose()
        expect(ctx.get('a')).toBeUndefined()
        expect(ctx.get('b')).toBeUndefined()
    })
})
