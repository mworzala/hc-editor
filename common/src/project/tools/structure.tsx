import { useEffect, useState } from 'react'
import {
    ChevronRightIcon,
    ListTreeIcon,
    BoxIcon,
    BracesIcon,
    HashIcon,
    SquareDashedIcon,
    TypeIcon,
    VariableIcon,
} from 'lucide-react'
import type {
    DocumentSymbol,
    Range as LspRange,
    SymbolInformation,
    SymbolKind,
} from 'vscode-languageserver-types'

import { cn, ScrollArea } from '@hollowcube/design-system'

import { fileUriFromPath } from '../../editor/languages/luau-editor-services'
import { rangeToOffsets } from '../../lsp/cm/lspUtils'
import { type LspClient } from '../../lsp/LspClient'
import { useLuauLsp, useProject } from '../../model'
import { type ActiveEditorRegistry } from '../../model/active-editor'
import { useLayout } from '../../model/workspace'
import { findLeaf, type Tab, type WorkspaceState } from '../../workspace'
import { type ToolDefinition } from '../registry'

// "Structure" tool — outline view of the currently focused text editor.
// Subscribes to the focused-leaf identity in the workspace store; when it
// changes (or the document is edited), refetches `textDocument/documentSymbol`
// on a debounce. Clicking an entry navigates the focused editor.

export const STRUCTURE_TOOL_KIND = 'tool:structure'

const REFRESH_DELAY_MS = 500

type FocusedDoc = {
    /** The `tab.id` of the focused text editor, used as a stable key. */
    tabId: string
    /** LSP URI of the focused document. */
    uri: string
    /** File path (relative). */
    path: string
}

function StructurePane() {
    const layout = useLayout()
    const { client, status } = useLuauLsp()
    const [focused, setFocused] = useState<FocusedDoc | null>(() => readFocus(layout.state.peek()))

    // Track focused-leaf changes by subscribing to the layout state signal.
    useEffect(() => {
        return layout.state.subscribe(() => {
            const next = readFocus(layout.state.peek())
            setFocused((prev) => (sameFocus(prev, next) ? prev : next))
        })
    }, [layout])

    return (
        <div className='flex h-full flex-col'>
            <div className='flex items-center justify-between px-2 py-1.5'>
                <span className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
                    Structure
                </span>
            </div>
            <ScrollArea className='min-h-0 flex-1'>
                {renderBody(client, status, focused)}
            </ScrollArea>
        </div>
    )
}

function renderBody(
    client: LspClient | null,
    status: string,
    focused: FocusedDoc | null,
): React.ReactNode {
    if (focused && client && status === 'running') {
        return <SymbolTree client={client} focused={focused} />
    }
    if (focused) {
        return <Empty>LSP not running.</Empty>
    }
    return <Empty>Focus a text editor to see its outline.</Empty>
}

function SymbolTree({ client, focused }: { client: LspClient; focused: FocusedDoc }) {
    const symbols = useDocumentSymbols(client, focused)
    const activeEditor = useProject().activeEditor
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
    const handleToggle = (id: string) => {
        setCollapsed((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    if (symbols === null) {
        return <Empty>Loading…</Empty>
    }
    if (symbols.length === 0) {
        return <Empty>No symbols.</Empty>
    }
    return (
        <ul className='flex flex-col gap-px px-1 py-1' role='tree'>
            {symbols.map((s, i) => (
                <SymbolRow
                    key={s.id}
                    sym={s}
                    depth={0}
                    path={`${i}`}
                    collapsed={collapsed}
                    onToggle={handleToggle}
                    onPick={(range) => navigateInFocusedEditor(activeEditor, focused.tabId, range)}
                />
            ))}
        </ul>
    )
}

type NormalizedSymbol = {
    id: string
    name: string
    detail?: string
    kind: SymbolKind
    range: LspRange
    selectionRange: LspRange
    children: NormalizedSymbol[]
}

function SymbolRow({
    sym,
    depth,
    path,
    collapsed,
    onToggle,
    onPick,
}: {
    sym: NormalizedSymbol
    depth: number
    path: string
    collapsed: Set<string>
    onToggle: (id: string) => void
    onPick: (range: LspRange) => void
}) {
    const hasKids = sym.children.length > 0
    const isCollapsed = collapsed.has(path)
    return (
        <li role='treeitem' aria-expanded={hasKids ? !isCollapsed : undefined}>
            <button
                type='button'
                onClick={() => onPick(sym.selectionRange)}
                className={cn(
                    'group flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left text-xs',
                    'hover:bg-muted/40',
                )}
                style={{ paddingLeft: `${4 + depth * 12}px` }}
            >
                {hasKids ? (
                    <span
                        role='button'
                        tabIndex={-1}
                        aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                        onClick={(e) => {
                            e.stopPropagation()
                            onToggle(path)
                        }}
                        className='inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground'
                    >
                        <ChevronRightIcon
                            className={cn(
                                'h-3 w-3 transition-transform',
                                isCollapsed ? '' : 'rotate-90',
                            )}
                        />
                    </span>
                ) : (
                    <span className='inline-block h-3.5 w-3.5 shrink-0' />
                )}
                <SymbolKindIcon kind={sym.kind} />
                <span className='truncate'>{sym.name}</span>
                {sym.detail ? (
                    <span className='ml-1 truncate text-[0.65rem] text-muted-foreground'>
                        {sym.detail}
                    </span>
                ) : null}
            </button>
            {hasKids && !isCollapsed ? (
                <ul className='flex flex-col gap-px' role='group'>
                    {sym.children.map((c, i) => (
                        <SymbolRow
                            key={c.id}
                            sym={c}
                            depth={depth + 1}
                            path={`${path}/${i}`}
                            collapsed={collapsed}
                            onToggle={onToggle}
                            onPick={onPick}
                        />
                    ))}
                </ul>
            ) : null}
        </li>
    )
}

function SymbolKindIcon({ kind }: { kind: SymbolKind }) {
    // Use a few representative icons; default for the long tail keeps the row
    // visually consistent.
    const className = 'h-3 w-3 shrink-0 text-muted-foreground'
    switch (kind) {
        case 5: // Class
        case 11: // Interface
        case 23: // Struct
            return <BoxIcon className={className} />
        case 12: // Function
        case 6: // Method
            return <BracesIcon className={className} />
        case 14: // Constant
        case 16: // Number
        case 20: // EnumMember
            return <HashIcon className={className} />
        case 13: // Variable
        case 7: // Property
        case 8: // Field
            return <VariableIcon className={className} />
        case 26: // TypeParameter
        case 22: // Enum
            return <TypeIcon className={className} />
        default:
            return <SquareDashedIcon className={className} />
    }
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className='text-muted-foreground flex h-full items-center justify-center p-4 text-center text-xs'>
            {children}
        </div>
    )
}

function readFocus(state: WorkspaceState): FocusedDoc | null {
    const leafId = state.focusedLeafId
    if (!leafId) return null
    const leaf = findLeaf(state.center, leafId)
    if (!leaf || !leaf.activeId) return null
    const tab = leaf.tabs.find((t) => t.id === leaf.activeId)
    if (!tab) return null
    const path = readTabPath(tab)
    if (!path) return null
    return { tabId: tab.id, uri: fileUriFromPath(path), path }
}

function readTabPath(tab: Tab): string | null {
    if (tab.kind !== 'editor:text') return null
    const payload = tab.payload as { path?: string } | undefined
    if (typeof payload?.path === 'string') return payload.path
    return null
}

function sameFocus(a: FocusedDoc | null, b: FocusedDoc | null): boolean {
    if (a === b) return true
    if (!a || !b) return false
    return a.tabId === b.tabId && a.uri === b.uri
}

function navigateInFocusedEditor(
    activeEditor: ActiveEditorRegistry,
    tabId: string,
    range: LspRange,
): void {
    const entry = activeEditor.get(tabId)
    if (!entry) return
    const { from } = rangeToOffsets(entry.view.state.doc, range)
    entry.view.dispatch({
        selection: { anchor: from, head: from },
        scrollIntoView: true,
    })
    entry.view.focus()
}

/** Subscribe to documentSymbol requests for the focused document. Returns
 *  `null` while the first response is in-flight. Re-runs on edits via the
 *  client's diagnostic stream as a cheap "document was re-analyzed" signal. */
export function useDocumentSymbols(
    client: LspClient | null,
    focused: FocusedDoc | null,
): NormalizedSymbol[] | null {
    const [state, setState] = useState<NormalizedSymbol[] | null>(null)
    const key = focused?.uri ?? ''

    useEffect(() => {
        if (!client || !focused) {
            setState(null)
            return
        }
        let cancelled = false
        let timer: number | null = null
        let inFlight = false

        const fetch = async () => {
            if (cancelled) return
            if (inFlight) return
            inFlight = true
            let result: DocumentSymbol[] | SymbolInformation[] | null = null
            try {
                result = await client.sendRequest<DocumentSymbol[] | SymbolInformation[] | null>(
                    'textDocument/documentSymbol',
                    { textDocument: { uri: focused.uri } },
                )
            } catch {
                inFlight = false
                return
            }
            inFlight = false
            if (cancelled) return
            setState(normalize(result ?? []))
        }

        const schedule = () => {
            if (timer) window.clearTimeout(timer)
            timer = window.setTimeout(fetch, REFRESH_DELAY_MS)
        }

        // Initial fetch, then refresh on every diagnostics tick.
        void fetch()
        const unsubDiags = client.onDiagnostics((u) => {
            if (u !== focused.uri) return
            schedule()
        })
        return () => {
            cancelled = true
            if (timer) window.clearTimeout(timer)
            unsubDiags()
        }
    }, [client, focused, key])

    return state
}

function normalize(raw: DocumentSymbol[] | SymbolInformation[]): NormalizedSymbol[] {
    if (raw.length === 0) return []
    // DocumentSymbol has `children`; SymbolInformation has `containerName`.
    if ('children' in raw[0]! || 'range' in (raw[0] as DocumentSymbol)) {
        const tree = raw as DocumentSymbol[]
        return tree.map((s, i) => mapDocumentSymbol(s, `${i}`))
    }
    const flat = raw as SymbolInformation[]
    return flat.map((s, i) => ({
        id: `${i}`,
        name: s.name,
        kind: s.kind,
        range: s.location.range,
        selectionRange: s.location.range,
        children: [],
    }))
}

function mapDocumentSymbol(s: DocumentSymbol, path: string): NormalizedSymbol {
    return {
        id: path,
        name: s.name,
        detail: s.detail,
        kind: s.kind,
        range: s.range,
        selectionRange: s.selectionRange,
        children: (s.children ?? []).map((c, i) => mapDocumentSymbol(c, `${path}/${i}`)),
    }
}

export const structureTool: ToolDefinition = {
    kind: STRUCTURE_TOOL_KIND,
    title: 'Structure',
    icon: <ListTreeIcon />,
    defaultLocation: 'left',
    render: () => <StructurePane />,
}

/** Expose the symbol type for the palette source so we don't duplicate the
 *  normalization logic. */
export type { NormalizedSymbol }
export { navigateInFocusedEditor }
