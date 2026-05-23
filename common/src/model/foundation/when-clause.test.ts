import { describe, expect, test } from 'bun:test'

import {
    evaluateWhenClause,
    parseWhenClause,
    whenClauseIdentifiers,
    WhenClauseParseError,
} from './when-clause'

function evalWith(src: string, env: Record<string, unknown>): boolean {
    const ast = parseWhenClause(src)
    return evaluateWhenClause(ast, (key) => env[key])
}

describe('when-clause — basic operators', () => {
    test('bare identifier reads from lookup', () => {
        expect(evalWith('a', { a: true })).toBe(true)
        expect(evalWith('a', { a: false })).toBe(false)
        expect(evalWith('a', {})).toBe(false)
    })

    test('not inverts', () => {
        expect(evalWith('!a', { a: false })).toBe(true)
        expect(evalWith('!a', { a: true })).toBe(false)
        expect(evalWith('!a', {})).toBe(true)
    })

    test('and / or short-circuit', () => {
        expect(evalWith('a && b', { a: true, b: true })).toBe(true)
        expect(evalWith('a && b', { a: true, b: false })).toBe(false)
        expect(evalWith('a || b', { a: false, b: true })).toBe(true)
        expect(evalWith('a || b', { a: false, b: false })).toBe(false)
    })

    test('precedence: && binds tighter than ||', () => {
        expect(evalWith('a || b && c', { a: false, b: true, c: false })).toBe(false)
        expect(evalWith('a || b && c', { a: false, b: true, c: true })).toBe(true)
        expect(evalWith('a && b || c', { a: false, b: false, c: true })).toBe(true)
    })

    test('parens override precedence', () => {
        expect(evalWith('(a || b) && c', { a: true, b: false, c: false })).toBe(false)
        expect(evalWith('(a || b) && c', { a: true, b: false, c: true })).toBe(true)
    })

    test('equality: identifier vs string literal', () => {
        expect(evalWith("kind === 'editor'", { kind: 'editor' })).toBe(true)
        expect(evalWith("kind === 'editor'", { kind: 'tool' })).toBe(false)
        expect(evalWith("kind !== 'editor'", { kind: 'tool' })).toBe(true)
    })

    test('equality binds tighter than && and ||', () => {
        // a === 'x' && b — equality first
        expect(evalWith("k === 'x' && b", { k: 'x', b: true })).toBe(true)
        expect(evalWith("k === 'x' && b", { k: 'y', b: true })).toBe(false)
    })

    test('double-quoted and single-quoted strings both parse', () => {
        expect(evalWith('k === "x"', { k: 'x' })).toBe(true)
        expect(evalWith("k === 'x'", { k: 'x' })).toBe(true)
    })

    test('dotted identifiers are a single identifier token', () => {
        expect(evalWith('lsp.luau.running', { 'lsp.luau.running': true })).toBe(true)
    })
})

describe('when-clause — error handling', () => {
    test('unexpected character throws with column position', () => {
        try {
            parseWhenClause('a @ b')
            throw new Error('expected throw')
        } catch (e) {
            expect(e).toBeInstanceOf(WhenClauseParseError)
            expect((e as WhenClauseParseError).column).toBe(2)
        }
    })

    test('unterminated string throws', () => {
        expect(() => parseWhenClause("a === 'foo")).toThrow(WhenClauseParseError)
    })

    test('missing closing paren throws', () => {
        expect(() => parseWhenClause('(a && b')).toThrow(WhenClauseParseError)
    })

    test('trailing token throws', () => {
        expect(() => parseWhenClause('a b')).toThrow(WhenClauseParseError)
    })

    test('empty input throws', () => {
        expect(() => parseWhenClause('')).toThrow(WhenClauseParseError)
    })
})

describe('when-clause — identifier collection', () => {
    test('whenClauseIdentifiers returns the unique set used by the AST', () => {
        const ast = parseWhenClause("editorFocused && editorDirty || mode === 'edit'")
        const ids = [...whenClauseIdentifiers(ast)].toSorted()
        expect(ids).toEqual(['editorDirty', 'editorFocused', 'mode'])
    })

    test('whenClauseIdentifiers deduplicates', () => {
        const ast = parseWhenClause('a && a || a')
        expect(whenClauseIdentifiers(ast)).toEqual(['a'])
    })
})

describe('when-clause — evaluation edge cases', () => {
    test('unknown identifier evaluates to undefined (falsy)', () => {
        expect(evalWith('missing', {})).toBe(false)
        expect(evalWith("missing === 'x'", {})).toBe(false)
    })

    test('truthy non-boolean values are accepted in boolean position', () => {
        expect(evalWith('a', { a: 'yes' })).toBe(true)
        expect(evalWith('a', { a: 0 })).toBe(false)
        expect(evalWith('a', { a: null })).toBe(false)
    })
})
