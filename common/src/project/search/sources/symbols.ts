import { useEffect, useRef, useState } from 'react'
import type { Location, SymbolInformation, WorkspaceSymbol } from 'vscode-languageserver-types'

import { pathFromFileUri } from '../../../lsp/uriResolver'
import { useLuauLsp } from '../../../model'
import { type SearchResult } from '../types'

// `workspace/symbol` palette source. Debounced so we don't pelt the server on
// every keystroke; results stream in once the query settles.

const DEBOUNCE_MS = 200
const MIN_QUERY = 1
const LIMIT = 50

export function useWorkspaceSymbolResults(query: string): SearchResult[] {
    const { client, status } = useLuauLsp()
    const [results, setResults] = useState<SearchResult[]>([])
    const seqRef = useRef(0)

    useEffect(() => {
        const trimmed = query.trim()
        if (!client || status !== 'running' || trimmed.length < MIN_QUERY) {
            setResults([])
            return
        }
        const seq = ++seqRef.current
        const timer = window.setTimeout(async () => {
            let raw: WorkspaceSymbol[] | SymbolInformation[] | null = null
            try {
                raw = await client.sendRequest<WorkspaceSymbol[] | SymbolInformation[] | null>(
                    'workspace/symbol',
                    { query: trimmed },
                )
            } catch {
                return
            }
            if (seq !== seqRef.current) return
            setResults(buildResults(raw ?? [], trimmed).slice(0, LIMIT))
        }, DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
    }, [client, status, query])

    return results
}

function buildResults(
    raw: readonly (WorkspaceSymbol | SymbolInformation)[],
    query: string,
): SearchResult[] {
    const lower = query.toLowerCase()
    return raw.map((item, i): SearchResult => {
        const { uri, range } = locationOf(item)
        const path = pathFromUri(uri)
        const matches = computeMatchIndices(item.name, lower)
        return {
            kind: 'symbol',
            id: `symbol:${i}:${path}:${item.name}`,
            title: item.name,
            subtitle:
                item.containerName && item.containerName !== item.name
                    ? `${item.containerName} · ${path}`
                    : path,
            matches,
            // Best matches: prefix match > substring match > anything else
            score: scoreFor(item.name, lower),
            data: {
                name: item.name,
                containerName: item.containerName,
                symbolKind: item.kind,
                path,
                line: (range?.start.line ?? 0) + 1,
                column: range?.start.character ?? 0,
            },
        }
    })
}

function locationOf(s: WorkspaceSymbol | SymbolInformation): {
    uri: string
    range?: { start: { line: number; character: number } }
} {
    const loc = (s as SymbolInformation).location
    if (loc && 'uri' in loc && 'range' in loc) {
        return { uri: loc.uri, range: loc.range }
    }
    // WorkspaceSymbol with deferred location: { uri }
    const wloc = (s as WorkspaceSymbol).location as Location | { uri: string }
    if ('range' in wloc) return { uri: wloc.uri, range: wloc.range }
    return { uri: wloc.uri }
}

function pathFromUri(uri: string): string {
    const p = pathFromFileUri(uri)
    return p.startsWith('/') ? p.slice(1) : p
}

function computeMatchIndices(name: string, lower: string): number[] {
    const haystack = name.toLowerCase()
    const idx = haystack.indexOf(lower)
    if (idx < 0) return []
    const out: number[] = []
    for (let i = 0; i < lower.length; i++) out.push(idx + i)
    return out
}

function scoreFor(name: string, lower: string): number {
    const h = name.toLowerCase()
    if (h === lower) return 1000
    if (h.startsWith(lower)) return 500
    if (h.includes(lower)) return 100
    return 1
}
