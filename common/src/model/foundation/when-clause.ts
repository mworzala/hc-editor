// Tiny expression language for action when-clauses.
//
// Grammar (lowest-to-highest precedence):
//
//   expr     := or
//   or       := and ('||' and)*
//   and      := equality ('&&' equality)*
//   equality := unary (('===' | '!==') unary)*
//   unary    := '!' unary | primary
//   primary  := identifier | string | '(' expr ')'
//   identifier := /[A-Za-z_$][A-Za-z0-9_$.]*/
//   string     := "'" /[^']*/ "'" | '"' /[^"]*/ '"'
//
// Identifiers are context-key names; the evaluator's `lookup` resolves
// them. Equality always compares JS `===`; unknown keys evaluate to
// `undefined`, which is falsy in boolean position and never equal to a
// string literal.
//
// VS Code's when-clause grew on demand; this is the minimum set. Add
// operators (`in`, `=~`, integer literals, etc.) when a concrete consumer
// needs one — not before.

export type WhenAst =
    | { kind: 'identifier'; name: string }
    | { kind: 'string'; text: string }
    | { kind: 'not'; expr: WhenAst }
    | { kind: 'and'; left: WhenAst; right: WhenAst }
    | { kind: 'or'; left: WhenAst; right: WhenAst }
    | { kind: 'eq'; left: WhenAst; right: WhenAst }
    | { kind: 'neq'; left: WhenAst; right: WhenAst }

export class WhenClauseParseError extends Error {
    constructor(
        message: string,
        readonly column: number,
        readonly source: string,
    ) {
        super(
            `when-clause parse error at column ${column}: ${message}\n  ${source}\n  ${' '.repeat(column)}^`,
        )
        this.name = 'WhenClauseParseError'
    }
}

type Token =
    | { kind: 'identifier'; text: string; column: number }
    | { kind: 'string'; text: string; column: number }
    | { kind: 'op'; op: '&&' | '||' | '!' | '===' | '!==' | '(' | ')'; column: number }
    | { kind: 'eof'; column: number }

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$.]*/uy

function tokenize(src: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    while (i < src.length) {
        const c = src[i]!
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            i++
            continue
        }
        if (c === '(' || c === ')') {
            tokens.push({ kind: 'op', op: c, column: i })
            i++
            continue
        }
        if (c === '&' && src[i + 1] === '&') {
            tokens.push({ kind: 'op', op: '&&', column: i })
            i += 2
            continue
        }
        if (c === '|' && src[i + 1] === '|') {
            tokens.push({ kind: 'op', op: '||', column: i })
            i += 2
            continue
        }
        if (c === '=' && src[i + 1] === '=' && src[i + 2] === '=') {
            tokens.push({ kind: 'op', op: '===', column: i })
            i += 3
            continue
        }
        if (c === '!' && src[i + 1] === '=' && src[i + 2] === '=') {
            tokens.push({ kind: 'op', op: '!==', column: i })
            i += 3
            continue
        }
        if (c === '!') {
            tokens.push({ kind: 'op', op: '!', column: i })
            i++
            continue
        }
        if (c === "'" || c === '"') {
            const quote = c
            const start = i
            i++
            let value = ''
            while (i < src.length && src[i] !== quote) {
                value += src[i]
                i++
            }
            if (i >= src.length) {
                throw new WhenClauseParseError(
                    `unterminated string starting at column ${start}`,
                    start,
                    src,
                )
            }
            i++
            tokens.push({ kind: 'string', text: value, column: start })
            continue
        }
        IDENT_RE.lastIndex = i
        const m = IDENT_RE.exec(src)
        if (m && m.index === i) {
            tokens.push({ kind: 'identifier', text: m[0], column: i })
            i += m[0].length
            continue
        }
        throw new WhenClauseParseError(`unexpected character '${c}'`, i, src)
    }
    tokens.push({ kind: 'eof', column: i })
    return tokens
}

class Parser {
    private pos = 0

    constructor(
        private readonly tokens: Token[],
        private readonly src: string,
    ) {}

    parse(): WhenAst {
        const ast = this.parseOr()
        const tok = this.peek()
        if (tok.kind !== 'eof') {
            throw new WhenClauseParseError(
                `unexpected token after expression`,
                tok.column,
                this.src,
            )
        }
        return ast
    }

    private parseOr(): WhenAst {
        let left = this.parseAnd()
        while (this.match('op', '||')) {
            const right = this.parseAnd()
            left = { kind: 'or', left, right }
        }
        return left
    }

    private parseAnd(): WhenAst {
        let left = this.parseEquality()
        while (this.match('op', '&&')) {
            const right = this.parseEquality()
            left = { kind: 'and', left, right }
        }
        return left
    }

    private parseEquality(): WhenAst {
        let left = this.parseUnary()
        for (;;) {
            if (this.match('op', '===')) {
                left = { kind: 'eq', left, right: this.parseUnary() }
            } else if (this.match('op', '!==')) {
                left = { kind: 'neq', left, right: this.parseUnary() }
            } else {
                return left
            }
        }
    }

    private parseUnary(): WhenAst {
        if (this.match('op', '!')) {
            return { kind: 'not', expr: this.parseUnary() }
        }
        return this.parsePrimary()
    }

    private parsePrimary(): WhenAst {
        const tok = this.peek()
        if (tok.kind === 'identifier') {
            this.pos++
            return { kind: 'identifier', name: tok.text }
        }
        if (tok.kind === 'string') {
            this.pos++
            return { kind: 'string', text: tok.text }
        }
        if (tok.kind === 'op' && tok.op === '(') {
            this.pos++
            const inner = this.parseOr()
            const close = this.peek()
            if (close.kind !== 'op' || close.op !== ')') {
                throw new WhenClauseParseError(`expected ')'`, close.column, this.src)
            }
            this.pos++
            return inner
        }
        throw new WhenClauseParseError(`expected expression`, tok.column, this.src)
    }

    private peek(): Token {
        return this.tokens[this.pos]!
    }

    private match(kind: 'op', op: Extract<Token, { kind: 'op' }>['op']): boolean {
        const tok = this.peek()
        if (tok.kind === kind && tok.op === op) {
            this.pos++
            return true
        }
        return false
    }
}

export function parseWhenClause(src: string): WhenAst {
    const tokens = tokenize(src)
    return new Parser(tokens, src).parse()
}

export type WhenLookup = (key: string) => unknown

export function evaluateWhenClause(ast: WhenAst, lookup: WhenLookup): boolean {
    return Boolean(evaluateValue(ast, lookup))
}

function evaluateValue(ast: WhenAst, lookup: WhenLookup): unknown {
    switch (ast.kind) {
        case 'identifier':
            return lookup(ast.name)
        case 'string':
            return ast.text
        case 'not':
            return !evaluateValue(ast.expr, lookup)
        case 'and':
            return evaluateValue(ast.left, lookup) && evaluateValue(ast.right, lookup)
        case 'or':
            return evaluateValue(ast.left, lookup) || evaluateValue(ast.right, lookup)
        case 'eq':
            return evaluateValue(ast.left, lookup) === evaluateValue(ast.right, lookup)
        case 'neq':
            return evaluateValue(ast.left, lookup) !== evaluateValue(ast.right, lookup)
    }
}

/** Collect every identifier name referenced by an AST. Useful for callers
 *  that want to pre-warm context-key signals. */
export function whenClauseIdentifiers(ast: WhenAst): readonly string[] {
    const out = new Set<string>()
    visit(ast, (node) => {
        if (node.kind === 'identifier') out.add(node.name)
    })
    return [...out]
}

function visit(ast: WhenAst, fn: (node: WhenAst) => void): void {
    fn(ast)
    switch (ast.kind) {
        case 'not':
            visit(ast.expr, fn)
            return
        case 'and':
        case 'or':
        case 'eq':
        case 'neq':
            visit(ast.left, fn)
            visit(ast.right, fn)
    }
}
