import { useMemo } from 'react'

import { type EngineApiDoc, type EngineApiModule } from '../../../engine-api'
import { useEngineApi } from '../../../model'
import { fuzzyScore } from '../fuzzy'
import { type SearchResult } from '../types'

// Flattens the engine API doc into searchable entries — one per module plus
// one per static method/property/export (and export members). Invoking a
// result opens the docs editor focused on that symbol.

type DocsEntry = {
    /** Qualified display + fuzzy-match text, e.g. `@mapmaker/store.define_state`. */
    title: string
    subtitle: string
    moduleId: string
    symbol: string | null
}

function collectModule(moduleId: string, node: EngineApiModule, out: DocsEntry[]): void {
    out.push({ title: node.moduleName, subtitle: 'module', moduleId, symbol: null })

    for (const m of node.staticMethods ?? []) {
        out.push({
            title: `${node.moduleName}.${m.name}`,
            subtitle: node.moduleName,
            moduleId,
            symbol: m.name,
        })
    }
    for (const p of node.staticProperties ?? []) {
        out.push({
            title: `${node.moduleName}.${p.name}`,
            subtitle: node.moduleName,
            moduleId,
            symbol: p.name,
        })
    }
    for (const exp of node.exports ?? []) {
        out.push({
            title: `${node.moduleName}.${exp.name}`,
            subtitle: node.moduleName,
            moduleId,
            symbol: exp.name,
        })
        for (const m of exp.methods ?? []) {
            out.push({
                title: `${exp.name}.${m.name}`,
                subtitle: node.moduleName,
                moduleId,
                symbol: m.name,
            })
        }
        for (const p of exp.properties ?? []) {
            out.push({
                title: `${exp.name}.${p.name}`,
                subtitle: node.moduleName,
                moduleId,
                symbol: p.name,
            })
        }
    }
}

function buildEntries(doc: EngineApiDoc): DocsEntry[] {
    const entries: DocsEntry[] = []
    for (const [key, lib] of Object.entries(doc.libraries)) collectModule(key, lib, entries)
    for (const g of doc.globals) collectModule(g.moduleName, g, entries)
    return entries
}

/** Fuzzy-match engine API symbols against `query`. */
export function useDocsResults(query: string, limit = 50): SearchResult[] {
    const engine = useEngineApi()
    const entries = useMemo(
        () => (engine.status === 'ready' ? buildEntries(engine.bundle.doc) : []),
        [engine],
    )
    return useMemo(() => {
        const results: SearchResult[] = []
        for (const entry of entries) {
            const match = fuzzyScore(query, entry.title)
            if (!match) continue
            results.push({
                kind: 'docs',
                id: `docs:${entry.moduleId}:${entry.symbol ?? ''}`,
                title: entry.title,
                subtitle: entry.subtitle,
                matches: match.matches,
                score: match.score,
                data: { moduleId: entry.moduleId, symbol: entry.symbol },
            })
        }
        results.sort((a, b) => b.score - a.score)
        return results.slice(0, limit)
    }, [entries, query, limit])
}
