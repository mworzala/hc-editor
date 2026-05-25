import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'bun:test'

import { ActiveEditorRegistry, type ActiveEditorEntry } from './ActiveEditorRegistry'

function makeEntry(over?: Partial<ActiveEditorEntry>): ActiveEditorEntry {
    return {
        view: {} as EditorView,
        ...over,
    }
}

describe('ActiveEditorRegistry', () => {
    test('register + get roundtrip', () => {
        const reg = new ActiveEditorRegistry()
        const entry = makeEntry({ lspUri: 'file:///a.luau' })
        reg.register('tab-1', entry)
        expect(reg.get('tab-1')).toBe(entry)
        expect(reg.get('tab-missing')).toBeUndefined()
    })

    test('re-register replaces the prior entry', () => {
        const reg = new ActiveEditorRegistry()
        const a = makeEntry({ lspUri: 'file:///a.luau' })
        const b = makeEntry({ lspUri: 'file:///b.luau' })
        reg.register('tab-1', a)
        reg.register('tab-1', b)
        expect(reg.get('tab-1')).toBe(b)
    })

    test('unregister removes', () => {
        const reg = new ActiveEditorRegistry()
        reg.register('tab-1', makeEntry())
        reg.unregister('tab-1')
        expect(reg.get('tab-1')).toBeUndefined()
    })

    test('activeDocId starts null and tracks setActiveDocId', () => {
        const reg = new ActiveEditorRegistry()
        expect(reg.activeDocId.peek()).toBeNull()
        reg.setActiveDocId('tab-1')
        expect(reg.activeDocId.peek()).toBe('tab-1')
        reg.setActiveDocId(null)
        expect(reg.activeDocId.peek()).toBeNull()
    })

    test('dispose clears entries and resets activeDocId', () => {
        const reg = new ActiveEditorRegistry()
        reg.register('tab-1', makeEntry())
        reg.setActiveDocId('tab-1')
        reg.dispose()
        expect(reg.get('tab-1')).toBeUndefined()
        expect(reg.activeDocId.peek()).toBeNull()
    })
})
