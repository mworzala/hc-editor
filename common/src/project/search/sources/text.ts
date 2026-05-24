import { useEffect, useRef, useState } from 'react'

import { v1MapFilesGet, type HCClient, type MapFile } from '@hollowcube/api'

import { useApp, useLanguageService, useProject } from '../../../model'
import { useFileTreeService } from '../../../model/files'
import { useSignal } from '../../../model/foundation/react'
import { isTextContentType } from '../../tools/files-tree'
import { type SearchResult } from '../types'

type TextResult = Extract<SearchResult, { kind: 'text' }>

// Client-side cross-file text search.
//
// No per-file content cache: in practice text-search rarely repeats the
// exact same query, and editor tabs hold their own bytes via
// `TextModelService`. If repeat-query performance becomes a concern we
// can layer a tiny in-memory cache here.

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
    const { client } = useApp()
    const project = useProject()
    const fileTree = useFileTreeService()
    const files = useSignal(fileTree.list)
    const languageSvc = useLanguageService()

    const [state, setState] = useState<TextSearchState>({
        results: [],
        loading: false,
        scanned: 0,
        total: 0,
    })
    const abortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        abortRef.current?.abort()
        if (query.length < MIN_QUERY_LENGTH) {
            setState({ results: [], loading: false, scanned: 0, total: 0 })
            return
        }

        const controller = new AbortController()
        abortRef.current = controller

        const languageMimes = languageSvc.allMimes()
        const textFiles = files.filter((f) => isTextContentType(f.contentType, languageMimes))
        setState({ results: [], loading: true, scanned: 0, total: textFiles.length })

        const results: TextResult[] = []
        let scanned = 0
        let totalMatches = 0

        const scanFile = async (file: MapFile) => {
            if (controller.signal.aborted) return
            if (totalMatches >= TOTAL_LIMIT) return
            let text: string
            try {
                text = await loadFileText(client, project.projectId, file.path, controller.signal)
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
            results.sort((a, b) => b.score - a.score || a.data.path.localeCompare(b.data.path))
            setState({
                results,
                loading: false,
                scanned,
                total: textFiles.length,
            })
        })()

        return () => controller.abort()
    }, [client, files, project.projectId, query, languageSvc])

    return state
}

async function loadFileText(
    client: HCClient,
    projectId: string,
    path: string,
    signal: AbortSignal,
): Promise<string> {
    const data = await v1MapFilesGet(client, projectId, path, { signal })
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
    const lineStart = lineStartOf(text, matchIndex)
    const lineEnd = lineEndOf(text, matchIndex)
    const left = Math.max(lineStart, matchIndex - SNIPPET_WINDOW)
    const right = Math.min(lineEnd, matchIndex + matchLength + SNIPPET_WINDOW)
    const rawSnippet = text.slice(left, right)
    const snippet = rawSnippet.replaceAll(/\s+/gu, ' ').trim()
    const localMatch = matchIndex - left
    const trimmedLead = rawSnippet.length - rawSnippet.replace(/^\s+/u, '').length
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
