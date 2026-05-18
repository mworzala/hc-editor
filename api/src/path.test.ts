import { describe, expect, test } from 'bun:test'

import {
    encodeMapId,
    encodeWildcardPath,
    mapEditorBootstrapPath,
    mapEditorEventsPath,
    mapFilePath,
} from './path'

describe('path helpers — map routes', () => {
    test('encodeMapId percent-encodes a single component', () => {
        expect(encodeMapId('abc')).toBe('abc')
        expect(encodeMapId('a b/c')).toBe('a%20b%2Fc')
    })

    test('encodeWildcardPath strips a leading slash and encodes per-segment', () => {
        // No leading slash, but slashes between segments survive (the wildcard
        // captures multiple path segments).
        expect(encodeWildcardPath('/world/region/r.0.0.mca')).toBe('world/region/r.0.0.mca')
        expect(encodeWildcardPath('a b/c+d')).toBe('a%20b/c%2Bd')
    })

    test('bootstrap / events / file paths target /v1/maps/...', () => {
        expect(mapEditorBootstrapPath('m1')).toBe('/v1/maps/m1/editor/bootstrap')
        expect(mapEditorEventsPath('m1')).toBe('/v1/maps/m1/editor/events')
        expect(mapFilePath('m1', 'src/main.luau')).toBe('/v1/maps/m1/files/src/main.luau')
    })

    test('file path tolerates and trims a leading slash on the wildcard', () => {
        expect(mapFilePath('m1', '/a/b.txt')).toBe('/v1/maps/m1/files/a/b.txt')
    })
})
