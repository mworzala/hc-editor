import { describe, expect, test } from 'bun:test'

import { ActionRegistry } from '../actions/ActionRegistry'
import { ContextService } from '../context/ContextService'
import { SearchService } from './SearchService'

function makeService(): SearchService {
    const context = new ContextService()
    const actions = new ActionRegistry({ context })
    return new SearchService({ actions })
}

describe('SearchService — register / list', () => {
    test('register adds to the map; list reflects it; get returns by id', () => {
        const svc = makeService()
        svc.register({ id: 'files', title: 'Files' })
        svc.register({ id: 'docs', title: 'Docs' })
        expect(svc.list().map((s) => s.id)).toEqual(['files', 'docs'])
        expect(svc.get('files')?.title).toBe('Files')
        expect(svc.get('missing')).toBeUndefined()
    })

    test('re-register replaces the prior descriptor', () => {
        const svc = makeService()
        svc.register({ id: 'files', title: 'First' })
        svc.register({ id: 'files', title: 'Second' })
        expect(svc.get('files')?.title).toBe('Second')
    })

    test('disposer removes the entry', () => {
        const svc = makeService()
        const off = svc.register({ id: 'files', title: 'Files' })
        expect(svc.get('files')).toBeDefined()
        off()
        expect(svc.get('files')).toBeUndefined()
    })

    test('disposer is a no-op after re-registration replaced the entry', () => {
        const svc = makeService()
        const offFirst = svc.register({ id: 'files', title: 'First' })
        svc.register({ id: 'files', title: 'Second' })
        offFirst()
        expect(svc.get('files')?.title).toBe('Second')
    })
})

describe('SearchService — sources signal', () => {
    test('reactive view updates when registrations change', () => {
        const svc = makeService()
        expect(svc.sources.peek()).toEqual([])
        svc.register({ id: 'a', title: 'A' })
        expect(svc.sources.peek().map((s) => s.id)).toEqual(['a'])
        svc.register({ id: 'b', title: 'B' })
        expect(svc.sources.peek().map((s) => s.id)).toEqual(['a', 'b'])
    })
})

describe('SearchService — popup state', () => {
    test('openWith sets the tab, clears query, opens', () => {
        const svc = makeService()
        svc.setQuery('stale')
        svc.openWith('files')
        expect(svc.popupOpen.peek()).toBe(true)
        expect(svc.popupTab.peek()).toBe('files')
        expect(svc.popupQuery.peek()).toBe('')
    })

    test('close hides the popup but leaves the tab', () => {
        const svc = makeService()
        svc.openWith('symbols')
        svc.close()
        expect(svc.popupOpen.peek()).toBe(false)
        expect(svc.popupTab.peek()).toBe('symbols')
    })

    test('setTab / setQuery mutate without toggling open', () => {
        const svc = makeService()
        svc.setTab('text')
        svc.setQuery('foo')
        expect(svc.popupTab.peek()).toBe('text')
        expect(svc.popupQuery.peek()).toBe('foo')
        expect(svc.popupOpen.peek()).toBe(false)
    })
})

describe('SearchService — registered actions', () => {
    test('search.open* actions open the popup with the right tab', () => {
        const context = new ContextService()
        const actions = new ActionRegistry({ context })
        const svc = new SearchService({ actions })

        actions.run('search.openFiles')
        expect(svc.popupOpen.peek()).toBe(true)
        expect(svc.popupTab.peek()).toBe('files')

        actions.run('search.openSymbols')
        expect(svc.popupTab.peek()).toBe('symbols')

        actions.run('search.openAll')
        expect(svc.popupTab.peek()).toBe('all')
    })

    test('dispose removes registered actions', () => {
        const context = new ContextService()
        const actions = new ActionRegistry({ context })
        const svc = new SearchService({ actions })

        expect(actions.get('search.openAll')).toBeDefined()
        svc.dispose()
        expect(actions.get('search.openAll')).toBeUndefined()
    })
})

describe('SearchService — disposal', () => {
    test('dispose clears all registrations', () => {
        const svc = makeService()
        svc.register({ id: 'a', title: 'A' })
        svc.register({ id: 'b', title: 'B' })
        svc.dispose()
        expect(svc.list()).toEqual([])
    })
})
