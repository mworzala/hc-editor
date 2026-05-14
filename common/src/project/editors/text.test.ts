import { describe, expect, test } from 'bun:test'

import { lspPosToOffset, parseTextPayload } from './text'

describe('lspPosToOffset', () => {
    const text = 'line0\nline1\nline2'
    // offsets:  0-4   6-10  12-16
    // (line0 is 5 chars + \n=6, line1 is 5 chars + \n=12, line2 is 5 chars)

    test('returns 0 for line 0, char 0', () => {
        expect(lspPosToOffset(text, 0, 0)).toBe(0)
    })

    test('returns the character offset within line 0', () => {
        expect(lspPosToOffset(text, 0, 3)).toBe(3)
    })

    test('returns the start of a later line', () => {
        expect(lspPosToOffset(text, 1, 0)).toBe(6)
        expect(lspPosToOffset(text, 2, 0)).toBe(12)
    })

    test('clamps to line end when character is past end-of-line', () => {
        // line 0 is 5 chars; asking for char 99 should clamp to the line's end.
        expect(lspPosToOffset(text, 0, 99)).toBe(5)
    })

    test('clamps to text length when line is past end-of-file', () => {
        expect(lspPosToOffset(text, 999, 0)).toBe(text.length)
    })

    test('clamps negative line to 0', () => {
        expect(lspPosToOffset(text, -1, 5)).toBe(0)
    })

    test('clamps negative character to start of line', () => {
        expect(lspPosToOffset(text, 1, -5)).toBe(6)
    })

    test('handles a file without a trailing newline', () => {
        const noTrail = 'a\nb'
        expect(lspPosToOffset(noTrail, 1, 1)).toBe(3) // 'b' end
        expect(lspPosToOffset(noTrail, 1, 99)).toBe(3) // clamps to end
    })

    test('handles an empty string', () => {
        expect(lspPosToOffset('', 0, 0)).toBe(0)
        expect(lspPosToOffset('', 5, 5)).toBe(0)
    })
})

describe('parseTextPayload', () => {
    test('returns empty object for non-object input', () => {
        expect(parseTextPayload(null)).toEqual({})
        expect(parseTextPayload(undefined)).toEqual({})
        expect(parseTextPayload('string')).toEqual({})
        expect(parseTextPayload(42)).toEqual({})
    })

    test('parses path and tempId strings', () => {
        expect(parseTextPayload({ path: 'src/foo.luau' })).toEqual({
            path: 'src/foo.luau',
        })
        expect(parseTextPayload({ tempId: 't-123' })).toEqual({ tempId: 't-123' })
    })

    test('ignores non-string path/tempId fields', () => {
        expect(parseTextPayload({ path: 42, tempId: { not: 'a string' } })).toEqual({})
    })

    test('parses scrollToLine when a number', () => {
        expect(parseTextPayload({ scrollToLine: 12 })).toEqual({ scrollToLine: 12 })
    })

    test('ignores non-number scrollToLine', () => {
        expect(parseTextPayload({ scrollToLine: '12' })).toEqual({})
    })

    test('parses a fully-formed flashLspRange', () => {
        const range = { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 5 }
        expect(parseTextPayload({ flashLspRange: range })).toEqual({ flashLspRange: range })
    })

    test('rejects malformed flashLspRange (missing fields)', () => {
        expect(parseTextPayload({ flashLspRange: { startLine: 1 } })).toEqual({})
    })

    test('passes combined fields through', () => {
        const input = {
            path: 'src/foo.luau',
            scrollToLine: 10,
            flashLspRange: {
                startLine: 0,
                startCharacter: 0,
                endLine: 0,
                endCharacter: 5,
            },
        }
        expect(parseTextPayload(input)).toEqual(input)
    })
})
