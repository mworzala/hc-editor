import { useEffect, useMemo, useState } from 'react'
import { AlertCircleIcon, AlertTriangleIcon, FileIcon, InfoIcon, LightbulbIcon } from 'lucide-react'
import type { Diagnostic } from 'vscode-languageserver-types'

import { cn, ScrollArea } from '@hollowcube/design-system'

import { pathFromFileUri } from '../../lsp/uriResolver'
import { useLuauLsp } from '../../model'
import { useProjectActions } from '../actions'
import { TEXT_EDITOR_KIND } from '../editors/text'
import { type ToolDefinition } from '../registry'

// Workspace-wide diagnostics panel — sits in the bottom dock by default.
// Subscribes to the LSP client's per-URI diagnostic cache (which the
// workspace-diagnostic poller fills cross-file). Clicking a row opens the
// file at the diagnostic's range.

export const PROBLEMS_TOOL_KIND = 'tool:problems'

type Severity = 1 | 2 | 3 | 4

type Row = {
    uri: string
    path: string
    diag: Diagnostic
}

type Snapshot = {
    rows: readonly Row[]
    counts: Record<Severity, number>
}

const SEVERITY_LABEL: Record<Severity, string> = {
    1: 'Error',
    2: 'Warning',
    3: 'Info',
    4: 'Hint',
}

const SEVERITY_CLASS: Record<Severity, string> = {
    1: 'text-destructive',
    2: 'text-yellow-300',
    3: 'text-sky-300',
    4: 'text-muted-foreground',
}

function ProblemsPane() {
    const { client } = useLuauLsp()
    const [snapshot, setSnapshot] = useState<Snapshot>({
        rows: [],
        counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
    })
    const { openEditor } = useProjectActions()

    useEffect(() => {
        if (!client) {
            setSnapshot({ rows: [], counts: { 1: 0, 2: 0, 3: 0, 4: 0 } })
            return
        }
        const recompute = () => {
            setSnapshot(buildSnapshot(client.getAllDiagnostics()))
        }
        recompute()
        return client.onDiagnostics(recompute, { replay: false })
    }, [client])

    return (
        <div className='flex h-full flex-col'>
            <div className='flex items-center justify-between gap-2 px-3 py-1.5'>
                <span className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
                    Problems
                </span>
                <div className='flex items-center gap-2 text-[0.7rem]'>
                    <SeverityCount severity={1} count={snapshot.counts[1]} />
                    <SeverityCount severity={2} count={snapshot.counts[2]} />
                    <SeverityCount severity={3} count={snapshot.counts[3]} />
                    <SeverityCount severity={4} count={snapshot.counts[4]} />
                </div>
            </div>
            <ScrollArea className='min-h-0 flex-1'>
                {snapshot.rows.length === 0 ? (
                    <div className='text-muted-foreground flex h-full items-center justify-center p-6 text-xs'>
                        No problems.
                    </div>
                ) : (
                    <ProblemsList
                        rows={snapshot.rows}
                        onOpen={(row) => {
                            openEditor({
                                kind: TEXT_EDITOR_KIND,
                                payload: {
                                    path: row.path,
                                    scrollToLine: row.diag.range.start.line + 1,
                                    flashLspRange: {
                                        startLine: row.diag.range.start.line,
                                        startCharacter: row.diag.range.start.character,
                                        endLine: row.diag.range.end.line,
                                        endCharacter: row.diag.range.end.character,
                                    },
                                },
                                identityKey: 'path',
                            })
                        }}
                    />
                )}
            </ScrollArea>
        </div>
    )
}

function ProblemsList({ rows, onOpen }: { rows: readonly Row[]; onOpen: (row: Row) => void }) {
    const byPath = useMemo(() => groupByPath(rows), [rows])
    return (
        <ul className='flex flex-col gap-2 px-1 py-1 text-xs'>
            {byPath.map((group) => (
                <li key={group.path} className='flex flex-col gap-px'>
                    <div className='flex items-center gap-1 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-muted-foreground'>
                        <FileIcon className='h-3 w-3 shrink-0' />
                        <span className='truncate'>{group.path || '(unknown)'}</span>
                    </div>
                    {group.items.map((row, i) => {
                        const sev = (row.diag.severity ?? 1) as Severity
                        return (
                            <button
                                key={i}
                                type='button'
                                onClick={() => onOpen(row)}
                                className={cn(
                                    'flex items-start gap-2 rounded-sm px-2 py-1 text-left',
                                    'hover:bg-muted/40',
                                )}
                            >
                                <SeverityIcon severity={sev} />
                                <span className='flex min-w-0 flex-1 flex-col gap-px'>
                                    <span className='break-words'>{row.diag.message}</span>
                                    <span className='text-[0.65rem] text-muted-foreground'>
                                        {row.diag.source ?? 'luau'} · ln{' '}
                                        {row.diag.range.start.line + 1}, col{' '}
                                        {row.diag.range.start.character + 1}
                                    </span>
                                </span>
                            </button>
                        )
                    })}
                </li>
            ))}
        </ul>
    )
}

function SeverityIcon({ severity }: { severity: Severity }) {
    const className = cn('h-3 w-3 shrink-0 mt-0.5', SEVERITY_CLASS[severity])
    switch (severity) {
        case 1:
            return <AlertCircleIcon className={className} aria-label='Error' />
        case 2:
            return <AlertTriangleIcon className={className} aria-label='Warning' />
        case 3:
            return <InfoIcon className={className} aria-label='Info' />
        case 4:
            return <LightbulbIcon className={className} aria-label='Hint' />
    }
}

function SeverityCount({ severity, count }: { severity: Severity; count: number }) {
    if (count === 0) return null
    return (
        <span className={cn('inline-flex items-center gap-1', SEVERITY_CLASS[severity])}>
            <SeverityIcon severity={severity} />
            <span aria-label={SEVERITY_LABEL[severity]}>{count}</span>
        </span>
    )
}

function buildSnapshot(map: Map<string, readonly Diagnostic[]>): Snapshot {
    const rows: Row[] = []
    const counts: Record<Severity, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
    for (const [uri, diags] of map) {
        if (diags.length === 0) continue
        const path = pathFromUri(uri)
        for (const d of diags) {
            rows.push({ uri, path, diag: d })
            const sev = (d.severity ?? 1) as Severity
            counts[sev] = (counts[sev] ?? 0) + 1
        }
    }
    rows.sort((a, b) => {
        const ar = (a.diag.severity ?? 1) - (b.diag.severity ?? 1)
        if (ar !== 0) return ar
        if (a.path !== b.path) return a.path.localeCompare(b.path)
        if (a.diag.range.start.line !== b.diag.range.start.line)
            return a.diag.range.start.line - b.diag.range.start.line
        return a.diag.range.start.character - b.diag.range.start.character
    })
    return { rows, counts }
}

function groupByPath(rows: readonly Row[]): { path: string; items: Row[] }[] {
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
        const list = groups.get(row.path) ?? []
        list.push(row)
        groups.set(row.path, list)
    }
    return [...groups.entries()].map(([path, items]) => ({ path, items }))
}

function pathFromUri(uri: string): string {
    const p = pathFromFileUri(uri)
    return p.startsWith('/') ? p.slice(1) : p
}

export const problemsTool: ToolDefinition = {
    kind: PROBLEMS_TOOL_KIND,
    title: 'Problems',
    icon: <AlertCircleIcon />,
    defaultLocation: 'bottom',
    render: () => <ProblemsPane />,
}
