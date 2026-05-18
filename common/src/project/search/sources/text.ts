import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useHCClient, v1MapFilesGet, type HCClient, type MapFile } from '@hollowcube/api'
import { v1MapFilesGetKey } from '@hollowcube/api'

import { listAllLanguageMimes, useLanguages } from '../../../editor/languages'
import { useProject } from '../../context'
import { isTextContentType } from '../../tools/files-tree'
import { type SearchResult } from '../types'

type TextResult = Extract<SearchResult, { kind: 'text' }>

// Client-side cross-file text search.
//
// On each query: enumerate text files, fetch their content (cached via
// TanStack Query so re-queries are instant), grep with a case-insensitive
// substring match, return snippets with line/column for jump-to.
//
// Cost control:
//   • CONCURRENCY caps how many file fetches run in parallel.
//   • PER_FILE_LIMIT caps matches per file (avoids one file producing 10k hits).
//   • TOTAL_LIMIT caps total matches surfaced.
//   • Aborts the in-flight batch when the query changes — the AbortController
//     short-circuits both the network and the per-file scan loop.
//
// Caching: file content lives in TanStack Query under the same key as
// `useV1MapFilesGet`. Two consequences:
//   1. Repeated text searches for the same query don't re-download files.
//   2. Editor tabs that already loaded a file share its cached bytes with the
//      grepper (no double-fetch).

const CONCURRENCY = 6
const PER_FILE_LIMIT = 20
const TOTAL_LIMIT = 200
const SNIPPET_WINDOW = 40
const MIN_QUERY_LENGTH = 2

export type TextSearchState = {
    results: SearchResult[]
    loading: boolean
    scanned: number
    total: number
}

export function useTextSearchResults(query: string): TextSearchState {
    const project = useProject()
    const client = useHCClient()
    const queryClient = useQueryClient()
    const languages = useLanguages()

    const [state, setState] = useState<TextSearchState>({
        results: [],
        loading: false,
        scanned: 0,
        total: 0,
    })
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        // Always cancel any in-flight scan first; new query supersedes old.
        abortRef.current?.abort()
        if (query.length < MIN_QUERY_LENGTH) {
            setState({ results: [], loading: false, scanned: 0, total: 0 })
            return
        }

        const controller = new AbortController()
        abortRef.current = controller

        const languageMimes = listAllLanguageMimes(languages)
        const textFiles = project.files.filter((f) =>
            isTextContentType(f.contentType, languageMimes),
        )
        setState({ results: [], loading: true, scanned: 0, total: textFiles.length })

        const results: TextResult[] = []
        let scanned = 0
        let totalMatches = 0

        const scanFile = async (file: MapFile) => {
            if (controller.signal.aborted) return
            if (totalMatches >= TOTAL_LIMIT) return
            let text: string
            try {
                text = await loadFileText(client, queryClient, project.id, file.path)
            } catch {
                return
            } finally {
                scanned++
            }
            if (controller.signal.aborted) return
            const hits = grepText(file.path, text, query)
            const usable = hits.slice(0, Math.min(PER_FILE_LIMIT, TOTAL_LIMIT - totalMatches))
            results.push(...usable)
            totalMatches += usable.length
        }

        void (async () => {
            await runWithConcurrency(textFiles, scanFile, CONCURRENCY, controller.signal)
            if (controller.signal.aborted) return
            // Sort by score desc then by path so deterministic order is stable
            // across re-renders.
            results.sort((a, b) => b.score - a.score || a.data.path.localeCompare(b.data.path))
            setState({
                results,
                loading: false,
                scanned,
                total: textFiles.length,
            })
        })()

        return () => controller.abort()
    }, [client, project.files, project.id, query, queryClient, languages])

    return state
}

async function loadFileText(
    client: HCClient,
    queryClient: ReturnType<typeof useQueryClient>,
    projectId: string,
    path: string,
): Promise<string> {
    // Reuse the cached bytes if v1MapFilesGet has fetched this file already
    // (e.g. because the user has it open in an editor tab); otherwise run the
    // fetch through the query client so the cache picks it up.
    const data = await queryClient.fetchQuery({
        queryKey: v1MapFilesGetKey(projectId, path),
        queryFn: () => v1MapFilesGet(client, projectId, path),
    })
    return new TextDecoder('utf-8', { fatal: false }).decode(data.bytes)
}

function grepText(path: string, text: string, query: string): TextResult[] {
    const out: TextResult[] = []
    if (!query) return out
    const q = query.toLowerCase()
    const lower = text.toLowerCase()
    let from = 0
    let count = 0
    while (count < PER_FILE_LIMIT) {
        const idx = lower.indexOf(q, from)
        if (idx === -1) break
        const { snippet, matchStart, line, column } = makeSnippet(text, idx, q.length)
        out.push({
            kind: 'text',
            id: `text:${path}:${idx}`,
            title: snippet,
            subtitle: `${path}:${line}`,
            matches: rangeIndices(matchStart, q.length),
            score: 10 + Math.max(0, 5 - column),
            data: { path, line, column, snippet },
        })
        from = idx + q.length
        count++
    }
    return out
}

function makeSnippet(
    text: string,
    matchIndex: number,
    matchLength: number,
): { snippet: string; matchStart: number; line: number; column: number } {
    // Walk back to the start of the line, then forward to the end of the
    // line (or to a window cap).
    const lineStart = lineStartOf(text, matchIndex)
    const lineEnd = lineEndOf(text, matchIndex)
    const left = Math.max(lineStart, matchIndex - SNIPPET_WINDOW)
    const right = Math.min(lineEnd, matchIndex + matchLength + SNIPPET_WINDOW)
    const rawSnippet = text.slice(left, right)
    // Normalize whitespace to keep one-line snippets.
    const snippet = rawSnippet.replaceAll(/\s+/g, ' ').trim()
    const localMatch = matchIndex - left
    const trimmedLead = rawSnippet.length - rawSnippet.replace(/^\s+/, '').length
    return {
        snippet,
        matchStart: Math.max(0, localMatch - trimmedLead),
        line: lineNumberOf(text, matchIndex),
        column: matchIndex - lineStart + 1,
    }
}

function lineStartOf(text: string, index: number): number {
    const before = text.lastIndexOf('\n', index - 1)
    return before === -1 ? 0 : before + 1
}

function lineEndOf(text: string, index: number): number {
    const after = text.indexOf('\n', index)
    return after === -1 ? text.length : after
}

function lineNumberOf(text: string, index: number): number {
    // 1-based line number. Counting via string split is wasteful for huge
    // files, so walk explicitly.
    let line = 1
    for (let i = 0; i < index; i++) {
        if (text[i] === '\n') line++
    }
    return line
}

function rangeIndices(start: number, length: number): number[] {
    const out: number[] = []
    for (let i = 0; i < length; i++) out.push(start + i)
    return out
}

async function runWithConcurrency<T>(
    items: readonly T[],
    worker: (item: T) => Promise<void>,
    concurrency: number,
    signal: AbortSignal,
): Promise<void> {
    let i = 0
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (i < items.length) {
            if (signal.aborted) return
            const idx = i++
            const item = items[idx]
            if (item === undefined) return
            await worker(item)
        }
    })
    await Promise.all(runners)
}
