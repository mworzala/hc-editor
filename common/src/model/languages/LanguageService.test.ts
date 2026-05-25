import { describe, expect, test } from 'bun:test'

import type { LanguageDefinition } from '../../editor/languages/types'
import { LanguageService } from './LanguageService'

function fakeLang(
    over: Partial<LanguageDefinition> & Pick<LanguageDefinition, 'id'>,
): LanguageDefinition {
    return {
        mimeTypes: [],
        extensions: [],
        cmExtension: () => [],
        ...over,
    } as LanguageDefinition
}

const json = fakeLang({
    id: 'json',
    mimeTypes: ['application/json'],
    extensions: ['.json'],
})

const luau = fakeLang({
    id: 'luau',
    mimeTypes: ['text/x-luau', 'application/luau'],
    extensions: ['.luau', '.lua'],
})

const text = fakeLang({
    id: 'plaintext',
    mimeTypes: ['text/*'],
    extensions: ['.txt', '.md'],
})

describe('LanguageService — byId', () => {
    test('returns the language by id; undefined for missing', () => {
        const svc = new LanguageService([json, luau])
        expect(svc.byId('luau')?.id).toBe('luau')
        expect(svc.byId('json')?.id).toBe('json')
        expect(svc.byId('missing')).toBeUndefined()
        expect(svc.byId(undefined)).toBeUndefined()
    })
})

describe('LanguageService — byMime', () => {
    test('exact match wins', () => {
        const svc = new LanguageService([json, luau])
        expect(svc.byMime('application/json')?.id).toBe('json')
        expect(svc.byMime('application/luau')?.id).toBe('luau')
    })

    test('wildcard `<type>/*` patterns match', () => {
        const svc = new LanguageService([text, json])
        expect(svc.byMime('text/plain')?.id).toBe('plaintext')
        expect(svc.byMime('text/markdown')?.id).toBe('plaintext')
        // exact still wins when also wildcard-matched: order in `languages`
        // decides — json declared after text here, so text/plain → plaintext.
        expect(svc.byMime('application/json')?.id).toBe('json')
    })

    test('no match returns undefined', () => {
        const svc = new LanguageService([json])
        expect(svc.byMime('image/png')).toBeUndefined()
        expect(svc.byMime(undefined)).toBeUndefined()
    })
})

describe('LanguageService — byPath', () => {
    test('extension match (case-insensitive)', () => {
        const svc = new LanguageService([json, luau])
        expect(svc.byPath('src/foo.luau')?.id).toBe('luau')
        expect(svc.byPath('src/foo.LUAU')?.id).toBe('luau')
        expect(svc.byPath('config.json')?.id).toBe('json')
    })

    test('no extension returns undefined', () => {
        const svc = new LanguageService([json, luau])
        expect(svc.byPath('Makefile')).toBeUndefined()
        expect(svc.byPath(undefined)).toBeUndefined()
    })

    test('unknown extension returns undefined', () => {
        const svc = new LanguageService([json, luau])
        expect(svc.byPath('archive.zip')).toBeUndefined()
    })
})

describe('LanguageService — allMimes', () => {
    test('returns every mime, preserving duplicates across languages', () => {
        const svc = new LanguageService([json, luau, text])
        expect(svc.allMimes()).toEqual([
            'application/json',
            'text/x-luau',
            'application/luau',
            'text/*',
        ])
    })
})

describe('LanguageService — disposal', () => {
    test('dispose is a no-op', () => {
        const svc = new LanguageService([json])
        svc.dispose()
        // Languages are still readable after dispose — by design.
        expect(svc.byId('json')?.id).toBe('json')
    })
})
