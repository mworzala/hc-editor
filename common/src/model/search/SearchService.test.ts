import { describe, expect, test } from 'bun:test'

import { SearchService } from './SearchService'

describe('SearchService — register / list', () => {
    test('register adds to the map; list reflects it; get returns by id', () => {
        const svc = new SearchService()
        svc.register({ id: 'files', title: 'Files' })
        svc.register({ id: 'docs', title: 'Docs' })
        expect(svc.list().map((s) => s.id)).toEqual(['files', 'docs'])
        expect(svc.get('files')?.title).toBe('Files')
        expect(svc.get('missing')).toBeUndefined()
    })

    test('re-register replaces the prior descriptor', () => {
        const svc = new SearchService()
        svc.register({ id: 'files', title: 'First' })
        svc.register({ id: 'files', title: 'Second' })
        expect(svc.get('files')?.title).toBe('Second')
    })

    test('disposer removes the entry', () => {
        const svc = new SearchService()
        const off = svc.register({ id: 'files', title: 'Files' })
        expect(svc.get('files')).toBeDefined()
        off()
        expect(svc.get('files')).toBeUndefined()
    })

    test('disposer is a no-op after re-registration replaced the entry', () => {
        const svc = new SearchService()
        const offFirst = svc.register({ id: 'files', title: 'First' })
        svc.register({ id: 'files', title: 'Second' })
        offFirst()
        expect(svc.get('files')?.title).toBe('Second')
    })
})

describe('SearchService — sources signal', () => {
    test('reactive view updates when registrations change', () => {
        const svc = new SearchService()
        expect(svc.sources.peek()).toEqual([])
        svc.register({ id: 'a', title: 'A' })
        expect(svc.sources.peek().map((s) => s.id)).toEqual(['a'])
        svc.register({ id: 'b', title: 'B' })
        expect(svc.sources.peek().map((s) => s.id)).toEqual(['a', 'b'])
    })
})

describe('SearchService — disposal', () => {
    test('dispose clears all registrations', () => {
        const svc = new SearchService()
        svc.register({ id: 'a', title: 'A' })
        svc.register({ id: 'b', title: 'B' })
        svc.dispose()
        expect(svc.list()).toEqual([])
    })
})
