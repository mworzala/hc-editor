import { beforeEach, describe, expect, test } from 'bun:test'

import { ActionRegistry } from './registry-class'
import { type Action } from './types'

const runCtx = { source: 'programmatic' as const }

function noop() {}

function makeAction(overrides: Partial<Action> = {}): Action {
    return {
        id: 'test.action',
        title: 'Test',
        run: noop,
        ...overrides,
    }
}

describe('ActionRegistry', () => {
    let registry: ActionRegistry

    beforeEach(() => {
        registry = new ActionRegistry()
    })

    describe('register / unregister', () => {
        test('register stores the action and bumps version', () => {
            const before = registry.version
            registry.register(makeAction({ id: 'a' }))
            expect(registry.get('a')).toBeDefined()
            expect(registry.version).toBeGreaterThan(before)
        })

        test('register returns an unregister function that removes the action', () => {
            const unreg = registry.register(makeAction({ id: 'a' }))
            unreg()
            expect(registry.get('a')).toBeUndefined()
        })

        test('unregister returned by register is identity-scoped — a newer registration is not erased', () => {
            const first = makeAction({ id: 'a', title: 'First' })
            const unregFirst = registry.register(first)
            const second = makeAction({ id: 'a', title: 'Second' })
            registry.register(second)

            unregFirst()
            // The second registration must survive because it replaced the first.
            expect(registry.get('a')?.title).toBe('Second')
        })

        test('unregister(id) removes the action and bumps version', () => {
            registry.register(makeAction({ id: 'a' }))
            const before = registry.version
            registry.unregister('a')
            expect(registry.get('a')).toBeUndefined()
            expect(registry.version).toBeGreaterThan(before)
        })

        test('unregister on an unknown id is a no-op', () => {
            const before = registry.version
            registry.unregister('missing')
            expect(registry.version).toBe(before)
        })
    })

    describe('run', () => {
        test('returns true and invokes the handler for a registered action', () => {
            let called = false
            registry.register(
                makeAction({
                    id: 'a',
                    run: () => {
                        called = true
                    },
                }),
            )
            const ok = registry.run('a', runCtx)
            expect(ok).toBe(true)
            expect(called).toBe(true)
        })

        test('returns false for unknown id', () => {
            expect(registry.run('missing', runCtx)).toBe(false)
        })

        test('respects `disabled` — does not invoke and returns false', () => {
            let called = false
            registry.register(
                makeAction({
                    id: 'a',
                    disabled: true,
                    run: () => {
                        called = true
                    },
                }),
            )
            expect(registry.run('a', runCtx)).toBe(false)
            expect(called).toBe(false)
        })

        test('respects `when` guard — does not invoke when false, returns false', () => {
            let called = false
            registry.register(
                makeAction({
                    id: 'a',
                    when: () => false,
                    run: () => {
                        called = true
                    },
                }),
            )
            expect(registry.run('a', runCtx)).toBe(false)
            expect(called).toBe(false)
        })

        test('forwards run-context (source, args) to the handler', () => {
            let received: unknown = null
            registry.register(
                makeAction({
                    id: 'a',
                    run: (ctx) => {
                        received = ctx
                    },
                }),
            )
            const ctx = { source: 'context-menu' as const, args: { path: 'x' } }
            registry.run('a', ctx)
            expect(received).toEqual(ctx)
        })

        test('a thrown handler does not corrupt registry state', () => {
            registry.register(
                makeAction({
                    id: 'a',
                    run: () => {
                        throw new Error('boom')
                    },
                }),
            )
            registry.register(makeAction({ id: 'b' }))
            // Should not throw out to the caller.
            expect(registry.run('a', runCtx)).toBe(true)
            // The registry still serves other actions cleanly.
            expect(registry.get('b')).toBeDefined()
        })
    })

    describe('list / get', () => {
        test('list returns every registered action', () => {
            registry.register(makeAction({ id: 'a' }))
            registry.register(makeAction({ id: 'b' }))
            const ids = registry
                .list()
                .map((a) => a.id)
                .toSorted()
            expect(ids).toEqual(['a', 'b'])
        })

        test('list reflects unregistration', () => {
            registry.register(makeAction({ id: 'a' }))
            registry.register(makeAction({ id: 'b' }))
            registry.unregister('a')
            expect(registry.list().map((a) => a.id)).toEqual(['b'])
        })
    })

    describe('subscribe', () => {
        test('fires the listener on register / unregister', () => {
            let fires = 0
            registry.subscribe(() => fires++)
            registry.register(makeAction({ id: 'a' }))
            expect(fires).toBe(1)
            registry.unregister('a')
            expect(fires).toBe(2)
        })

        test('returns an unsubscribe handle that stops further notifications', () => {
            let fires = 0
            const unsub = registry.subscribe(() => fires++)
            registry.register(makeAction({ id: 'a' }))
            unsub()
            registry.unregister('a')
            expect(fires).toBe(1)
        })

        test('does not fire on no-op unregister', () => {
            let fires = 0
            registry.subscribe(() => fires++)
            registry.unregister('missing')
            expect(fires).toBe(0)
        })
    })
})
