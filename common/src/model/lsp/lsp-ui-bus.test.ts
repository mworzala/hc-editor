import { describe, expect, test } from 'bun:test'

import { LspUiBus } from './lsp-ui-bus'

describe('LspUiBus — signals', () => {
    test('opening / closing the code-action menu toggles its signal', () => {
        const bus = new LspUiBus()
        expect(bus.codeAction.peek()).toBeNull()
        bus.openCodeActionMenu({ x: 10, y: 20, items: [], onSelect: () => {} })
        expect(bus.codeAction.peek()).not.toBeNull()
        expect(bus.codeAction.peek()?.x).toBe(10)
        bus.closeCodeActionMenu()
        expect(bus.codeAction.peek()).toBeNull()
    })

    test('opening / closing the rename prompt toggles its signal', () => {
        const bus = new LspUiBus()
        expect(bus.rename.peek()).toBeNull()
        bus.openRenamePrompt({ x: 1, y: 2, initialName: 'foo', onConfirm: () => {} })
        expect(bus.rename.peek()?.initialName).toBe('foo')
        bus.closeRenamePrompt()
        expect(bus.rename.peek()).toBeNull()
    })

    test('opening one kind does not affect the other', () => {
        const bus = new LspUiBus()
        bus.openCodeActionMenu({ x: 0, y: 0, items: [], onSelect: () => {} })
        expect(bus.codeAction.peek()).not.toBeNull()
        expect(bus.rename.peek()).toBeNull()
        bus.openRenamePrompt({ x: 0, y: 0, initialName: 'x', onConfirm: () => {} })
        expect(bus.codeAction.peek()).not.toBeNull()
        expect(bus.rename.peek()).not.toBeNull()
    })

    test('close is a no-op when nothing is open', () => {
        const bus = new LspUiBus()
        bus.closeCodeActionMenu()
        bus.closeRenamePrompt()
        expect(bus.codeAction.peek()).toBeNull()
        expect(bus.rename.peek()).toBeNull()
    })

    test('dispose clears both signals', () => {
        const bus = new LspUiBus()
        bus.openCodeActionMenu({ x: 0, y: 0, items: [], onSelect: () => {} })
        bus.openRenamePrompt({ x: 0, y: 0, initialName: 'x', onConfirm: () => {} })
        bus.dispose()
        expect(bus.codeAction.peek()).toBeNull()
        expect(bus.rename.peek()).toBeNull()
    })
})
