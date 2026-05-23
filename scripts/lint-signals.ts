#!/usr/bin/env bun
/**
 * Signals discipline check.
 *
 * Walks every TypeScript file under `common/src/model/**` (excluding
 * `*.test.ts` and `react.{ts,tsx}`) and flags `.value` reads that are not
 * lexically inside a `computed(...)` or `effect(...)` callback.
 *
 * Why: in the services + signals architecture, services hold state in
 * preact signals. Inside `computed`/`effect`, reading `signal.value`
 * registers a reactive dependency — that's the intended behavior. In
 * imperative methods (`save`, `setContent`, action handlers), reading
 * `.value` silently captures dependencies on whatever tracking context
 * happens to be on the stack — almost always a bug. Use `.peek()` in
 * methods instead.
 *
 * The check is lexical only: it tracks whether the AST walk is currently
 * inside a call expression named `computed` or `effect`. Assignments
 * (`signal.value = x`) are allowed because they're mutations, not reads.
 *
 * Caveat: false positives are possible when a callback is extracted from
 * a reactive call (`array.map(item => signal.value)`). If you hit one
 * that's genuinely fine, restructure the code, move the read into a
 * `peek()`, or — when neither is reasonable — silence the line with a
 * `// lint:signals-ignore` comment on the same line or the line above.
 * Use sparingly; the comment is documenting an architectural exception,
 * not a quick fix.
 *
 * Invocation: `bun run scripts/lint-signals.ts` (also chained from
 * `bun run lint`).
 */

import { promises as fs, type Dirent } from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dir, '..')
const MODEL_ROOT = path.join(ROOT, 'common', 'src', 'model')

type Diagnostic = {
    file: string
    line: number
    column: number
    snippet: string
}

const REACTIVE_CALLS = new Set(['computed', 'effect'])

async function collectSourceFiles(dir: string): Promise<string[]> {
    let entries: Dirent[]
    try {
        entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    const out: string[] = []
    for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            out.push(...(await collectSourceFiles(full)))
            continue
        }
        if (!entry.isFile()) continue
        const name = entry.name
        if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
        if (name === 'react.ts' || name === 'react.tsx') continue
        if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
        out.push(full)
    }
    return out
}

function isWriteTarget(node: ts.PropertyAccessExpression): boolean {
    const parent = node.parent
    if (!parent) return false
    if (ts.isBinaryExpression(parent) && parent.left === node) {
        const op = parent.operatorToken.kind
        // Assignment-flavored operators. Any of these means the access is a
        // write target, not a read.
        return (
            op === ts.SyntaxKind.EqualsToken ||
            op === ts.SyntaxKind.PlusEqualsToken ||
            op === ts.SyntaxKind.MinusEqualsToken ||
            op === ts.SyntaxKind.AsteriskEqualsToken ||
            op === ts.SyntaxKind.SlashEqualsToken ||
            op === ts.SyntaxKind.PercentEqualsToken ||
            op === ts.SyntaxKind.AmpersandEqualsToken ||
            op === ts.SyntaxKind.BarEqualsToken ||
            op === ts.SyntaxKind.CaretEqualsToken ||
            op === ts.SyntaxKind.AsteriskAsteriskEqualsToken ||
            op === ts.SyntaxKind.LessThanLessThanEqualsToken ||
            op === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken ||
            op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken ||
            op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
            op === ts.SyntaxKind.BarBarEqualsToken ||
            op === ts.SyntaxKind.QuestionQuestionEqualsToken
        )
    }
    // `++signal.value` / `--signal.value` / postfix.
    if (
        (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
        (parent.operator === ts.SyntaxKind.PlusPlusToken ||
            parent.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
        return true
    }
    return false
}

function checkFile(filePath: string, source: string): Diagnostic[] {
    const sourceFile = ts.createSourceFile(
        filePath,
        source,
        ts.ScriptTarget.ESNext,
        /* setParentNodes */ true,
        filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const diagnostics: Diagnostic[] = []

    const visit = (node: ts.Node, depth: number) => {
        let nextDepth = depth

        // If this node is a `computed(...)` or `effect(...)` call, increment
        // depth for its arguments. The callee can be a plain identifier
        // (`computed(...)`) or a property access (`signals.computed(...)`)
        // — match the rightmost name in either case.
        if (ts.isCallExpression(node)) {
            const callee = node.expression
            let name: string | undefined
            if (ts.isIdentifier(callee)) name = callee.text
            else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text
            if (name && REACTIVE_CALLS.has(name)) nextDepth = depth + 1
        }

        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'value' &&
            !isWriteTarget(node) &&
            depth === 0
        ) {
            // We've found a `.value` read outside any reactive call.
            // Note: we check `depth` (the depth at *this* node), not
            // `nextDepth` (which only applies to child nodes).
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
                node.name.getStart(sourceFile),
            )
            const sourceLines = source.split('\n')
            const lineText = sourceLines[line] ?? ''
            const prevLineText = line > 0 ? (sourceLines[line - 1] ?? '') : ''
            // Same-line and immediately-preceding-line escape hatches.
            const hasIgnore =
                lineText.includes('lint:signals-ignore') ||
                prevLineText.includes('lint:signals-ignore')
            if (!hasIgnore) {
                diagnostics.push({
                    file: filePath,
                    line: line + 1,
                    column: character + 1,
                    snippet: lineText.trim(),
                })
            }
        }

        ts.forEachChild(node, (child) => visit(child, nextDepth))
    }

    visit(sourceFile, 0)
    return diagnostics
}

async function main(): Promise<void> {
    const files = await collectSourceFiles(MODEL_ROOT)
    if (files.length === 0) {
        console.warn('[lint:signals] no model files yet — skipping')
        return
    }

    const allDiagnostics: Diagnostic[] = []
    for (const file of files) {
        const source = await fs.readFile(file, 'utf8')
        allDiagnostics.push(...checkFile(file, source))
    }

    if (allDiagnostics.length === 0) {
        console.warn(`[lint:signals] ${files.length} files checked, 0 issues`)
        return
    }

    console.error(
        `[lint:signals] ${allDiagnostics.length} issue${allDiagnostics.length === 1 ? '' : 's'} ` +
            `in ${files.length} file${files.length === 1 ? '' : 's'}:\n`,
    )
    for (const d of allDiagnostics) {
        const rel = path.relative(ROOT, d.file)
        console.error(`  ${rel}:${d.line}:${d.column}`)
        console.error(`    ${d.snippet}`)
        console.error(
            `    \`.value\` read outside computed/effect. Use \`.peek()\` in imperative methods,\n` +
                `    or move this read into a reactive callback. See docs/model-architecture.md.`,
        )
        console.error()
    }
    process.exit(1)
}

await main()
