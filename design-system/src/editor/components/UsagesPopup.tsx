import { Button } from '@hollowcube/design-system/components/button'
import { cn } from '@hollowcube/design-system/lib/utils'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import { CodeEditor } from '../CodeEditor'

export type UsageMatch = {
    line: number // 1-indexed line in the source doc
    col: number // 1-indexed column where the match starts
    from: number // absolute char offset
    to: number // absolute char offset
    snippet: string // the line containing the match (trimmed for display)
}

type Props = {
    open: boolean
    onClose: () => void
    /** The target string the user searched usages for. */
    token: string
    /** The full source doc. */
    source: string
    /** Computed matches against `source`. */
    matches: UsageMatch[]
    /** Called when the user picks a match (single click on a row). The host can use
     *  this to jump the underlying editor selection / scroll. */
    onSelect?: (match: UsageMatch) => void
}

const PREVIEW_LINES_BEFORE = 4
const PREVIEW_LINES_AFTER = 4

function UsagesPopup({ open, onClose, token, source, matches, onSelect }: Props) {
    const [selectedIdx, setSelectedIdx] = React.useState(0)
    const containerRef = React.useRef<HTMLDivElement | null>(null)

    React.useEffect(() => {
        if (!open) return
        setSelectedIdx(0)
    }, [open, token])

    React.useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
                return
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIdx((i) => Math.min(i + 1, matches.length - 1))
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIdx((i) => Math.max(i - 1, 0))
            }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
    }, [open, onClose, matches.length])

    React.useEffect(() => {
        if (!open || !onSelect || matches.length === 0) return
        const match = matches[selectedIdx]
        if (match) onSelect(match)
    }, [open, selectedIdx, matches, onSelect])

    if (!open) return null

    const selected = matches[selectedIdx]
    const previewSlice = selected ? sliceAround(source, selected.line) : null

    return (
        <div
            ref={containerRef}
            className='absolute inset-0 z-40 flex flex-col bg-popover/95 ring-1 ring-border backdrop-blur-sm'
            role='dialog'
            aria-modal='true'
            aria-label={`Usages of "${token}"`}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose()
            }}
        >
            <header className='flex items-center justify-between border-b border-border px-4 py-2'>
                <div className='flex items-baseline gap-2'>
                    <span className='text-sm font-medium'>Usages of</span>
                    <code className='rounded-sm bg-secondary px-1.5 py-0.5 text-[0.75rem]'>
                        {token}
                    </code>
                    <span className='text-muted-foreground text-xs'>
                        {matches.length === 1 ? '1 match' : `${matches.length} matches`}
                    </span>
                </div>
                <Button size='icon-sm' variant='ghost' aria-label='Close' onClick={onClose}>
                    <XIcon />
                </Button>
            </header>
            <div className='flex min-h-0 flex-1 overflow-hidden'>
                <ul className='w-[220px] shrink-0 overflow-auto border-r border-border'>
                    {matches.map((m, idx) => (
                        <li key={`${m.line}:${m.col}`}>
                            <button
                                type='button'
                                onClick={() => setSelectedIdx(idx)}
                                className={cn(
                                    'group flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[0.75rem] transition-colors',
                                    'hover:bg-muted',
                                    idx === selectedIdx &&
                                        'bg-primary/15 text-foreground hover:bg-primary/20',
                                )}
                            >
                                <span className='text-muted-foreground w-8 shrink-0 text-right font-mono tabular-nums'>
                                    {m.line}:{m.col}
                                </span>
                                <span className='truncate font-mono'>
                                    {highlightToken(m.snippet, token)}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
                <div className='min-h-0 min-w-0 flex-1 overflow-hidden'>
                    {selected && previewSlice ? (
                        <CodeEditor
                            value={previewSlice.text}
                            readOnly
                            lineOffset={previewSlice.lineOffset}
                            highlightRanges={selectedHighlightRanges(source, previewSlice, matches)}
                            enableInteractions={false}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    )
}

// Tokenized text rendering with the matched span highlighted in primary.
function highlightToken(line: string, token: string) {
    if (!token) return line
    const idx = line.indexOf(token)
    if (idx === -1) return line
    return (
        <>
            <span>{line.slice(0, idx)}</span>
            <mark className='bg-primary/30 text-foreground rounded-sm px-0.5'>
                {line.slice(idx, idx + token.length)}
            </mark>
            <span>{line.slice(idx + token.length)}</span>
        </>
    )
}

type PreviewSlice = {
    text: string
    lineOffset: number
    sliceCharStart: number
}

function sliceAround(source: string, line: number): PreviewSlice {
    const lines = source.split('\n')
    const from = Math.max(0, line - 1 - PREVIEW_LINES_BEFORE)
    const to = Math.min(lines.length, line - 1 + PREVIEW_LINES_AFTER + 1)
    const sliced = lines.slice(from, to).join('\n')
    // Compute absolute char offset of the slice start so we can re-map
    // highlight ranges from absolute → slice-local coordinates.
    let charStart = 0
    for (let i = 0; i < from; i++) charStart += (lines[i]?.length ?? 0) + 1
    return { text: sliced, lineOffset: from, sliceCharStart: charStart }
}

function selectedHighlightRanges(_source: string, slice: PreviewSlice, matches: UsageMatch[]) {
    const start = slice.sliceCharStart
    const end = start + slice.text.length
    return matches
        .filter((m) => m.from >= start && m.to <= end)
        .map((m) => ({ from: m.from - start, to: m.to - start }))
}

export { UsagesPopup }
