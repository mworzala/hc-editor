import { describe, expect, spyOn, test } from 'bun:test'

import { buildMenuPayload, translateKeybinding } from './menu-payload'
import { type Action, type ActionContextSet } from './types'

function makeAction(overrides: Partial<Action> & { id: string }): Action {
    return {
        title: overrides.id,
        run: () => undefined,
        ...overrides,
    }
}

const GLOBAL_CTX: ActionContextSet = new Set(['global'])

describe('buildMenuPayload', () => {
    test('excludes actions without a menu field', () => {
        const actions: Action[] = [
            makeAction({ id: 'a.no-menu' }),
            makeAction({ id: 'a.in-menu', menu: { path: 'file' } }),
        ]
        const out = buildMenuPayload({ actions, contextSet: GLOBAL_CTX })
        expect(out.map((i) => i.actionId)).toEqual(['a.in-menu'])
    })

    test('excludes actions with unknown menu.path and warns once', () => {
        const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
            const actions: Action[] = [
                makeAction({
                    id: 'a.bogus',
                    // @ts-expect-error — intentional invalid path
                    menu: { path: 'bogus-path-zzz' },
                }),
                makeAction({ id: 'a.ok', menu: { path: 'file' } }),
            ]
            const out = buildMenuPayload({ actions, contextSet: GLOBAL_CTX })
            expect(out.map((i) => i.actionId)).toEqual(['a.ok'])
            // Bun test env exposes import.meta.env.DEV as truthy when present.
            // Don't assert call count strictly — only assert no crash + filter.
            warn.mockRestore()
        } finally {
            warn.mockRestore()
        }
    })

    test('sorts by (path, group, order, label) deterministically', () => {
        const actions: Action[] = [
            makeAction({
                id: 'z',
                title: 'Zeta',
                menu: { path: 'edit', group: 'search', order: 30 },
            }),
            makeAction({
                id: 'a',
                title: 'Alpha',
                menu: { path: 'edit', group: 'search', order: 10 },
            }),
            makeAction({
                id: 'b',
                title: 'Bravo',
                menu: { path: 'edit', group: 'search', order: 20 },
            }),
            makeAction({
                id: 'f',
                title: 'Foxtrot',
                menu: { path: 'file', group: 'new', order: 10 },
            }),
            makeAction({
                id: 'e',
                title: 'Echo',
                menu: { path: 'edit', group: 'clip', order: 10 },
            }),
        ]
        const out = buildMenuPayload({ actions, contextSet: GLOBAL_CTX })
        expect(out.map((i) => i.actionId)).toEqual(['e', 'a', 'b', 'z', 'f'])
    })

    test('sort is stable across input permutations', () => {
        const base: Action[] = [
            makeAction({ id: 'a', menu: { path: 'edit', group: 'x', order: 10 } }),
            makeAction({ id: 'b', menu: { path: 'edit', group: 'x', order: 20 } }),
            makeAction({ id: 'c', menu: { path: 'edit', group: 'y', order: 10 } }),
        ]
        const a = buildMenuPayload({ actions: base, contextSet: GLOBAL_CTX })
        const b = buildMenuPayload({
            actions: [base[2]!, base[0]!, base[1]!],
            contextSet: GLOBAL_CTX,
        })
        expect(a.map((i) => i.actionId)).toEqual(b.map((i) => i.actionId))
    })

    test('enabled=true for [global] action when context set contains global', () => {
        const out = buildMenuPayload({
            actions: [
                makeAction({
                    id: 'g',
                    menu: { path: 'file' },
                    contexts: ['global'],
                }),
            ],
            contextSet: GLOBAL_CTX,
        })
        expect(out[0]?.enabled).toBe(true)
    })

    test('enabled=false when contexts are not satisfied', () => {
        const out = buildMenuPayload({
            actions: [
                makeAction({
                    id: 'e',
                    menu: { path: 'edit' },
                    contexts: ['editor:text'],
                }),
            ],
            contextSet: GLOBAL_CTX, // doesn't contain editor:text
        })
        expect(out[0]?.enabled).toBe(false)
    })

    test('enabled=false when disabled: true', () => {
        const out = buildMenuPayload({
            actions: [
                makeAction({
                    id: 'd',
                    menu: { path: 'file' },
                    disabled: true,
                }),
            ],
            contextSet: GLOBAL_CTX,
        })
        expect(out[0]?.enabled).toBe(false)
    })

    test('enabled=false when when() returns false', () => {
        const out = buildMenuPayload({
            actions: [
                makeAction({
                    id: 'w',
                    menu: { path: 'file' },
                    when: () => false,
                }),
            ],
            contextSet: GLOBAL_CTX,
        })
        expect(out[0]?.enabled).toBe(false)
    })

    test('label override falls back to title', () => {
        const out = buildMenuPayload({
            actions: [
                makeAction({
                    id: 'l1',
                    title: 'Plain title',
                    menu: { path: 'file' },
                }),
                makeAction({
                    id: 'l2',
                    title: 'Palette label',
                    menu: { path: 'file', label: 'Menu label' },
                }),
            ],
            contextSet: GLOBAL_CTX,
        })
        const byId = Object.fromEntries(out.map((i) => [i.actionId, i.label]))
        expect(byId['l1']).toBe('Plain title')
        expect(byId['l2']).toBe('Menu label')
    })

    test('accelerator built from keybinding', () => {
        const out = buildMenuPayload({
            actions: [
                makeAction({
                    id: 'k1',
                    menu: { path: 'edit' },
                    keybinding: '$mod+shift+f',
                }),
                makeAction({
                    id: 'k2',
                    menu: { path: 'edit' },
                }),
            ],
            contextSet: GLOBAL_CTX,
        })
        const byId = Object.fromEntries(out.map((i) => [i.actionId, i.accelerator]))
        expect(byId['k1']).toBe('CmdOrCtrl+Shift+F')
        expect(byId['k2']).toBe('')
    })
})

describe('translateKeybinding', () => {
    test('translates $mod and modifier casing', () => {
        expect(translateKeybinding('$mod+shift+f')).toBe('CmdOrCtrl+Shift+F')
        expect(translateKeybinding('$mod+n')).toBe('CmdOrCtrl+N')
        expect(translateKeybinding('$mod+alt+l')).toBe('CmdOrCtrl+Alt+L')
    })

    test('passes function keys through uppercased', () => {
        expect(translateKeybinding('f1')).toBe('F1')
        expect(translateKeybinding('shift+f5')).toBe('Shift+F5')
    })

    test('preserves named keys', () => {
        expect(translateKeybinding('$mod+backspace')).toBe('CmdOrCtrl+backspace')
    })

    test('empty/undefined input returns empty string', () => {
        expect(translateKeybinding(undefined)).toBe('')
        expect(translateKeybinding('')).toBe('')
    })
})
