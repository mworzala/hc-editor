import { beforeEach, describe, expect, test } from 'bun:test'

import { ContextService } from '../context/ContextService'
import { ActionRegistry } from './ActionRegistry'
import type { Action } from './types'

let context: ContextService
let registry: ActionRegistry

beforeEach(() => {
    context = new ContextService()
    registry = new ActionRegistry({ context })
})

function makeAction(over: Partial<Action> & Pick<Action, 'id'>): Action {
    return {
        title: over.title ?? `Action ${over.id}`,
        run: over.run ?? (() => {}),
        ...over,
    }
}

describe('ActionRegistry — registration', () => {
    test('register adds the action; get/list reflect it', () => {
        registry.register(makeAction({ id: 'editor.save' }))
        expect(registry.get('editor.save')?.id).toBe('editor.save')
        expect(registry.list()).toHaveLength(1)
    })

    test('disposer removes the action', () => {
        const off = registry.register(makeAction({ id: 'a' }))
        off()
        expect(registry.get('a')).toBeUndefined()
        expect(registry.list()).toEqual([])
    })

    test('disposer is a no-op after the action was re-registered under the same id', () => {
        const offFirst = registry.register(makeAction({ id: 'a', title: 'first' }))
        registry.register(makeAction({ id: 'a', title: 'second' }))
        offFirst()
        // Newer registration must survive.
        expect(registry.get('a')?.title).toBe('second')
    })

    test('unregister removes by id', () => {
        registry.register(makeAction({ id: 'a' }))
        registry.unregister('a')
        expect(registry.get('a')).toBeUndefined()
    })

    test('unregister of a missing id is a no-op', () => {
        registry.unregister('does-not-exist')
        expect(registry.list()).toEqual([])
    })
})

describe('ActionRegistry — run', () => {
    test('run invokes the handler with args; returns true', () => {
        let received: unknown
        registry.register(
            makeAction({
                id: 'a',
                run: (args) => {
                    received = args
                },
            }),
        )
        expect(registry.run('a', { x: 1 })).toBe(true)
        expect(received).toEqual({ x: 1 })
    })

    test('run on a missing id returns false', () => {
        expect(registry.run('nope')).toBe(false)
    })

    test('run with a when-clause that is false returns false and does not invoke', () => {
        let called = 0
        registry.register(
            makeAction({
                id: 'a',
                when: 'gate',
                run: () => {
                    called++
                },
            }),
        )
        expect(registry.run('a')).toBe(false)
        expect(called).toBe(0)
        context.set('gate', true)
        expect(registry.run('a')).toBe(true)
        expect(called).toBe(1)
    })

    test('run on a disabled action returns false', () => {
        let called = 0
        registry.register(
            makeAction({
                id: 'a',
                disabled: true,
                run: () => {
                    called++
                },
            }),
        )
        expect(registry.run('a')).toBe(false)
        expect(called).toBe(0)
    })

    test('synchronous throws are caught and logged', () => {
        const originalError = console.error
        const errors: unknown[] = []
        console.error = (...args) => {
            errors.push(args)
        }
        try {
            registry.register(
                makeAction({
                    id: 'a',
                    run: () => {
                        throw new Error('boom')
                    },
                }),
            )
            expect(registry.run('a')).toBe(true)
            expect(errors).toHaveLength(1)
        } finally {
            console.error = originalError
        }
    })
})

describe('ActionRegistry — enabledActions', () => {
    test('reflects registrations as they happen', () => {
        expect(registry.enabledActions.value).toEqual([])
        registry.register(makeAction({ id: 'a' }))
        expect(registry.enabledActions.value.map((a) => a.id)).toEqual(['a'])
        registry.register(makeAction({ id: 'b' }))
        expect(registry.enabledActions.value.map((a) => a.id).toSorted()).toEqual(['a', 'b'])
    })

    test('filters out actions whose when-clause is false', () => {
        registry.register(makeAction({ id: 'a' }))
        registry.register(makeAction({ id: 'b', when: 'gate' }))
        expect(registry.enabledActions.value.map((a) => a.id)).toEqual(['a'])
        context.set('gate', true)
        expect(registry.enabledActions.value.map((a) => a.id).toSorted()).toEqual(['a', 'b'])
        context.set('gate', false)
        expect(registry.enabledActions.value.map((a) => a.id)).toEqual(['a'])
    })

    test('an action with a satisfied when-clause is included', () => {
        context.set('mode', 'edit')
        registry.register(makeAction({ id: 'a', when: "mode === 'edit'" }))
        expect(registry.enabledActions.value.map((a) => a.id)).toEqual(['a'])
    })
})

describe('ActionRegistry — keybindings', () => {
    test('keybindingFor returns the action keybinding', () => {
        registry.register(makeAction({ id: 'a', keybinding: '$mod+s' }))
        expect(registry.keybindingFor('a')).toBe('$mod+s')
        expect(registry.keybindingFor('missing')).toBeUndefined()
    })

    test('actionForKeybinding finds the action by binding', () => {
        registry.register(makeAction({ id: 'a', keybinding: '$mod+s' }))
        registry.register(makeAction({ id: 'b', keybinding: '$mod+shift+s' }))
        expect(registry.actionForKeybinding('$mod+s')?.id).toBe('a')
        expect(registry.actionForKeybinding('$mod+shift+s')?.id).toBe('b')
        expect(registry.actionForKeybinding('$mod+q')).toBeUndefined()
    })
})

describe('ActionRegistry — disposal', () => {
    test('dispose clears the action set', () => {
        registry.register(makeAction({ id: 'a' }))
        registry.register(makeAction({ id: 'b' }))
        registry.dispose()
        expect(registry.list()).toEqual([])
        expect(registry.enabledActions.value).toEqual([])
    })
})

describe('ActionRegistry — typed payloads', () => {
    type Args = { path: string; line?: number }
    test('register<TArgs> hands the handler a typed args parameter', () => {
        let captured: Args | undefined
        registry.register<Args>({
            id: 'navigate',
            title: 'Navigate',
            run: (args) => {
                // Compile-time: args is typed as Args (not unknown).
                captured = args
            },
        })
        registry.run('navigate', { path: 'foo.txt', line: 12 })
        expect(captured?.path).toBe('foo.txt')
        expect(captured?.line).toBe(12)
    })

    test('runtime args at the run boundary are unchecked (handler narrows)', () => {
        let kind: string | undefined
        registry.register<Args>({
            id: 'navigate',
            title: 'Navigate',
            run: (args) => {
                kind = typeof args
            },
        })
        // Caller passes a value that wouldn't satisfy Args — registry doesn't
        // validate; handler is expected to defend itself.
        registry.run('navigate', 'not-an-object' as unknown)
        expect(kind).toBe('string')
    })
})
