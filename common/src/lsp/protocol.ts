// JSON-RPC framing + LSP capability declaration. LSP types come from
// vscode-languageserver-types (types-only, zero runtime deps). Editor-flavored
// coordinate conversion lives next to each CodeMirror extension (LSP speaks
// (line, character); CodeMirror speaks linear offsets).

import type { MarkedString, MarkupContent } from 'vscode-languageserver-types'

export type JsonRpcMessage = {
    jsonrpc: '2.0'
    id?: number | string
    method?: string
    params?: unknown
    result?: unknown
    error?: { code: number; message: string; data?: unknown }
}

export const LUAU_LANGUAGE_ID = 'luau'

export const SERVER_REQUESTS_TO_NULL_OUT = new Set<string>([
    'window/workDoneProgress/create',
])

export const LSP_SEVERITY = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
} as const

/** Flatten LSP hover contents into a list of markdown strings. */
export function markdownFromContents(
    contents: MarkupContent | MarkedString | MarkedString[],
): string[] {
    const out: string[] = []
    const push = (c: MarkedString | MarkupContent) => {
        if (typeof c === 'string') {
            out.push(c)
        } else if ('language' in c) {
            out.push('```' + c.language + '\n' + c.value + '\n```')
        } else {
            out.push(c.value)
        }
    }
    if (Array.isArray(contents)) contents.forEach(push)
    else push(contents)
    return out
}

export function clientCapabilities(): Record<string, unknown> {
    return {
        textDocument: {
            synchronization: {
                dynamicRegistration: false,
                willSave: false,
                willSaveWaitUntil: false,
                didSave: false,
            },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            completion: {
                completionItem: {
                    snippetSupport: true,
                    commitCharactersSupport: false,
                    documentationFormat: ['markdown', 'plaintext'],
                    deprecatedSupport: true,
                    insertReplaceSupport: false,
                    resolveSupport: { properties: ['documentation', 'detail'] },
                },
                completionItemKind: { valueSet: Array.from({ length: 25 }, (_, i) => i + 1) },
                contextSupport: true,
            },
            signatureHelp: {
                signatureInformation: {
                    documentationFormat: ['markdown', 'plaintext'],
                    parameterInformation: { labelOffsetSupport: true },
                    activeParameterSupport: true,
                },
            },
            definition: { linkSupport: true },
            typeDefinition: { linkSupport: true },
            references: {},
            documentSymbol: {
                dynamicRegistration: false,
                hierarchicalDocumentSymbolSupport: true,
            },
            documentLink: { dynamicRegistration: false, tooltipSupport: true },
            documentColor: {},
            // NOTE: we deliberately do NOT declare `textDocument.diagnostic`
            // (pull diagnostics). Declaring it causes luau-lsp to stop sending
            // `textDocument/publishDiagnostics` for open documents, and we
            // don't issue per-document `textDocument/diagnostic` pulls
            // ourselves — the result is that nothing ever populates the
            // problems channel for the active file. Push works for the open
            // buffer; `workspace.diagnostics.refreshSupport` below still
            // enables the workspace-wide pull for cross-file invalidations.
            codeAction: {
                codeActionLiteralSupport: {
                    codeActionKind: {
                        valueSet: [
                            '',
                            'quickfix',
                            'refactor',
                            'refactor.extract',
                            'refactor.inline',
                            'refactor.rewrite',
                            'source',
                            'source.organizeImports',
                        ],
                    },
                },
                isPreferredSupport: true,
                disabledSupport: true,
                resolveSupport: { properties: ['edit'] },
            },
            rename: { prepareSupport: true },
            foldingRange: { lineFoldingOnly: true },
            onTypeFormatting: {},
            inlayHint: {
                resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip'] },
            },
            semanticTokens: {
                requests: { full: true },
                tokenTypes: [
                    'namespace',
                    'type',
                    'class',
                    'enum',
                    'interface',
                    'struct',
                    'typeParameter',
                    'parameter',
                    'variable',
                    'property',
                    'enumMember',
                    'event',
                    'function',
                    'method',
                    'macro',
                    'keyword',
                    'modifier',
                    'comment',
                    'string',
                    'number',
                    'regexp',
                    'operator',
                ],
                tokenModifiers: [
                    'declaration',
                    'definition',
                    'readonly',
                    'static',
                    'deprecated',
                    'abstract',
                    'async',
                    'modification',
                    'documentation',
                    'defaultLibrary',
                ],
                formats: ['relative'],
            },
            callHierarchy: {},
            publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] } },
        },
        workspace: {
            workspaceFolders: true,
            applyEdit: true,
            configuration: true,
            executeCommand: { dynamicRegistration: false },
            symbol: {
                dynamicRegistration: false,
                resolveSupport: { properties: ['location.range'] },
            },
            didChangeWatchedFiles: { dynamicRegistration: true },
            diagnostics: { refreshSupport: true },
        },
    }
}
