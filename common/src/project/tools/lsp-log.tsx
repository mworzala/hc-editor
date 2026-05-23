import { useEffect, useMemo, useState } from 'react'
import {
    CheckIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    CopyIcon,
    ScrollTextIcon,
    Trash2Icon,
} from 'lucide-react'

import { Button, cn, ScrollArea } from '@hollowcube/design-system'

import { type LspLogMessage, type LspRpcMessage, type LspState } from '../../lsp'
import { useLuauLsp } from '../../model'
import { type ToolDefinition } from '../registry'

// Tool window that surfaces:
//  • Live LSP state (Starting / Running / Stopped / Failed)
//  • The `window/logMessage` + `window/showMessage` stream
//  • Every JSON-RPC frame the client sends/receives, with the full payload
//    collapsible per row. Useful when the server goes silent or returns
//    surprising results — the log usually carries the smoking gun.

export const LSP_LOG_TOOL_KIND = 'tool:lsp-log'

type Tab = 'log' | 'rpc' | 'config'

const LEVEL_BADGE: Record<LspLogMessage['level'], string> = {
    error: 'bg-destructive/15 text-destructive',
    warn: 'bg-yellow-500/15 text-yellow-300',
    info: 'bg-sky-500/15 text-sky-300',
    log: 'bg-muted/40 text-muted-foreground',
    debug: 'bg-muted/20 text-muted-foreground',
}

const STATE_LABEL: Record<LspState, string> = {
    starting: 'Starting…',
    running: 'Running',
    stopped: 'Stopped',
    failed: 'Failed',
}

const STATE_BADGE: Record<LspState, string> = {
    starting: 'bg-yellow-500/15 text-yellow-300',
    running: 'bg-emerald-500/15 text-emerald-300',
    stopped: 'bg-muted/40 text-muted-foreground',
    failed: 'bg-destructive/15 text-destructive',
}

const DIRECTION_BADGE = {
    'client→server': 'bg-sky-500/15 text-sky-300',
    'server→client': 'bg-violet-500/15 text-violet-300',
} as const

const KIND_LABEL: Record<LspRpcMessage['kind'], string> = {
    request: 'req',
    response: 'res',
    notification: 'note',
    error: 'err',
}

const KIND_BADGE: Record<LspRpcMessage['kind'], string> = {
    request: 'bg-sky-500/15 text-sky-300',
    response: 'bg-emerald-500/15 text-emerald-300',
    notification: 'bg-muted/40 text-muted-foreground',
    error: 'bg-destructive/15 text-destructive',
}

function LspLogPane() {
    const { status } = useLuauLsp()
    const [tab, setTab] = useState<Tab>('log')

    return (
        <div className='flex h-full flex-col'>
            <div className='border-border flex items-center justify-between gap-2 border-b px-3 py-2'>
                <div className='flex items-center gap-2'>
                    <span className='text-muted-foreground text-[0.7rem] uppercase tracking-wide'>
                        LSP
                    </span>
                    <span
                        className={cn(
                            'rounded-sm px-1.5 py-0.5 text-[0.7rem] font-medium',
                            STATE_BADGE[status],
                        )}
                    >
                        {STATE_LABEL[status]}
                    </span>
                </div>
                <div className='flex items-center gap-1'>
                    <TabButton active={tab === 'log'} onClick={() => setTab('log')}>
                        Log
                    </TabButton>
                    <TabButton active={tab === 'rpc'} onClick={() => setTab('rpc')}>
                        Messages
                    </TabButton>
                    <TabButton active={tab === 'config'} onClick={() => setTab('config')}>
                        Config
                    </TabButton>
                </div>
            </div>
            {tab === 'log' ? <LogList /> : tab === 'rpc' ? <RpcList /> : <ConfigPane />}
        </div>
    )
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            type='button'
            onClick={onClick}
            className={cn(
                'rounded-sm px-2 py-0.5 text-[0.7rem] font-medium transition-colors',
                active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
            )}
        >
            {children}
        </button>
    )
}

function LogList() {
    const { client } = useLuauLsp()
    const [messages, setMessages] = useState<readonly LspLogMessage[]>(() =>
        client ? client.getLogMessages() : [],
    )

    useEffect(() => {
        if (!client) {
            setMessages([])
            return
        }
        setMessages(client.getLogMessages())
        return client.onLogMessage((next) => setMessages(next))
    }, [client])

    const copyText = useMemo(() => formatLogForClipboard(messages), [messages])

    return (
        <>
            <Toolbar
                count={messages.length}
                onClear={() => client?.clearLogMessages()}
                onCopy={() => void copyToClipboard(copyText)}
                disabled={!client || messages.length === 0}
            />
            <ScrollArea className='min-h-0 flex-1'>
                {messages.length === 0 ? (
                    <Empty>No log messages yet.</Empty>
                ) : (
                    <ul className='flex flex-col gap-1 p-2 text-xs'>
                        {messages.map((m) => (
                            <li
                                key={m.id}
                                className='border-border/60 flex flex-col gap-1 rounded-sm border px-2 py-1.5'
                            >
                                <div className='flex items-center gap-2'>
                                    <span
                                        className={cn(
                                            'rounded-sm px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide',
                                            LEVEL_BADGE[m.level],
                                        )}
                                    >
                                        {m.level}
                                    </span>
                                    {m.show ? (
                                        <span className='text-muted-foreground text-[0.65rem] uppercase tracking-wide'>
                                            window/showMessage
                                        </span>
                                    ) : null}
                                    <span className='text-muted-foreground ml-auto font-mono text-[0.65rem]'>
                                        {formatTime(m.timestamp)}
                                    </span>
                                </div>
                                <pre className='font-mono text-[0.7rem] whitespace-pre-wrap break-words'>
                                    {m.message}
                                </pre>
                            </li>
                        ))}
                    </ul>
                )}
            </ScrollArea>
        </>
    )
}

function RpcList() {
    const { client } = useLuauLsp()
    // Defensive optional-chaining: a hot-reload of `LspClient.ts` leaves the
    // already-instantiated client in place, but the React module that hosts
    // this tool sees the new prototype. Guard against the gap until the user
    // reloads.
    const supportsRpcLog =
        !!client && typeof (client as { getRpcMessages?: unknown }).getRpcMessages === 'function'
    const [messages, setMessages] = useState<readonly LspRpcMessage[]>(() =>
        supportsRpcLog ? client.getRpcMessages() : [],
    )

    useEffect(() => {
        if (!supportsRpcLog || !client) {
            setMessages([])
            return
        }
        setMessages(client.getRpcMessages())
        return client.onRpcMessage((next) => setMessages(next))
    }, [client, supportsRpcLog])

    const copyText = useMemo(() => formatRpcForClipboard(messages), [messages])

    if (!supportsRpcLog) {
        return (
            <>
                <Toolbar count={0} onClear={() => {}} disabled />
                <Empty>
                    The LSP client doesn&apos;t expose a message log yet. Reload the page to pick up
                    the latest build.
                </Empty>
            </>
        )
    }

    return (
        <>
            <Toolbar
                count={messages.length}
                onClear={() => client?.clearRpcMessages()}
                onCopy={() => void copyToClipboard(copyText)}
                disabled={!client || messages.length === 0}
            />
            <ScrollArea className='min-h-0 flex-1'>
                {messages.length === 0 ? (
                    <Empty>No messages on the wire yet.</Empty>
                ) : (
                    <ul className='flex flex-col gap-1 p-2 text-xs'>
                        {messages.map((m) => (
                            <RpcRow key={m.id} msg={m} />
                        ))}
                    </ul>
                )}
            </ScrollArea>
        </>
    )
}

function ConfigPane() {
    // Re-read on LSP state changes — `settings` is populated during start().
    const { client, status } = useLuauLsp()
    const supportsSettings =
        !!client && typeof (client as { getSettings?: unknown }).getSettings === 'function'
    const settings = useMemo(() => {
        // `status` participates so the memo recomputes once the LSP starts and
        // getSettings() returns populated data, even though its value isn't read.
        void status
        return supportsSettings ? client.getSettings() : null
    }, [client, status, supportsSettings])
    const text = useMemo(() => (settings ? formatJsonPretty(settings) : ''), [settings])

    if (!supportsSettings) {
        return (
            <>
                <Toolbar count={0} onClear={() => {}} disabled />
                <Empty>
                    The LSP client doesn&apos;t expose its config yet. Reload the page to pick up
                    the latest build.
                </Empty>
            </>
        )
    }

    const empty = !settings || Object.keys(settings).length === 0

    return (
        <>
            <Toolbar
                count={empty ? 0 : 1}
                onClear={() => {}}
                onCopy={() => void copyToClipboard(text)}
                disabled={empty}
            />
            <ScrollArea className='min-h-0 flex-1'>
                {empty ? (
                    <Empty>No config sent yet — the LSP hasn&apos;t started.</Empty>
                ) : (
                    <pre className='m-0 p-3 font-mono text-[0.7rem] whitespace-pre-wrap break-words'>
                        {text}
                    </pre>
                )}
            </ScrollArea>
        </>
    )
}

function RpcRow({ msg }: { msg: LspRpcMessage }) {
    const [expanded, setExpanded] = useState(false)
    const summary = useMemo(() => summarizeRpc(msg), [msg])
    const arrow = msg.direction === 'client→server' ? '→' : '←'

    return (
        <li className='border-border/60 flex flex-col rounded-sm border'>
            <button
                type='button'
                onClick={() => setExpanded((v) => !v)}
                className='hover:bg-muted/30 flex items-center gap-2 px-2 py-1.5 text-left'
            >
                {expanded ? (
                    <ChevronDownIcon className='text-muted-foreground h-3 w-3 shrink-0' />
                ) : (
                    <ChevronRightIcon className='text-muted-foreground h-3 w-3 shrink-0' />
                )}
                <span
                    className={cn(
                        'rounded-sm px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide',
                        DIRECTION_BADGE[msg.direction],
                    )}
                >
                    {arrow}
                </span>
                <span
                    className={cn(
                        'rounded-sm px-1.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide',
                        KIND_BADGE[msg.kind],
                    )}
                >
                    {KIND_LABEL[msg.kind]}
                </span>
                <span className='truncate font-mono text-[0.7rem]'>
                    {msg.method ?? '(no method)'}
                </span>
                {summary ? (
                    <span className='text-muted-foreground truncate font-mono text-[0.65rem]'>
                        {summary}
                    </span>
                ) : null}
                <span className='text-muted-foreground ml-auto shrink-0 font-mono text-[0.65rem]'>
                    {msg.rpcId !== undefined ? `#${msg.rpcId} · ` : ''}
                    {formatTime(msg.timestamp)}
                </span>
            </button>
            {expanded ? (
                <pre className='border-border/60 m-0 max-h-96 overflow-auto border-t bg-muted/20 px-2 py-1.5 font-mono text-[0.7rem] whitespace-pre-wrap break-words'>
                    {formatJsonPretty(msg.payload)}
                </pre>
            ) : null}
        </li>
    )
}

function Toolbar({
    count,
    onClear,
    onCopy,
    disabled,
}: {
    count: number
    onClear: () => void
    onCopy?: () => void
    disabled: boolean
}) {
    const [copied, setCopied] = useState(false)
    useEffect(() => {
        if (!copied) return
        const id = window.setTimeout(() => setCopied(false), 1500)
        return () => window.clearTimeout(id)
    }, [copied])

    return (
        <div className='border-border flex items-center justify-between gap-2 border-b px-3 py-1'>
            <span className='text-muted-foreground text-[0.65rem]'>
                {count} {count === 1 ? 'entry' : 'entries'}
            </span>
            <div className='flex items-center gap-1'>
                {onCopy ? (
                    <Button
                        size='icon-sm'
                        variant='ghost'
                        disabled={disabled}
                        onClick={() => {
                            onCopy()
                            setCopied(true)
                        }}
                        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
                    >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                    </Button>
                ) : null}
                <Button
                    size='icon-sm'
                    variant='ghost'
                    disabled={disabled}
                    onClick={onClear}
                    aria-label='Clear'
                >
                    <Trash2Icon />
                </Button>
            </div>
        </div>
    )
}

function formatLogForClipboard(messages: readonly LspLogMessage[]): string {
    return messages
        .map((m) => {
            const ts = new Date(m.timestamp).toISOString()
            const tag = m.level.toUpperCase().padEnd(5, ' ')
            const channel = m.show ? ' [window/showMessage]' : ''
            return `[${ts}] ${tag}${channel} ${m.message}`
        })
        .join('\n')
}

function formatRpcForClipboard(messages: readonly LspRpcMessage[]): string {
    return messages
        .map((m) => {
            const ts = new Date(m.timestamp).toISOString()
            const arrow = m.direction === 'client→server' ? '-->' : '<--'
            const head = `[${ts}] ${arrow} ${m.kind.toUpperCase()} ${m.method ?? '(no method)'}${
                m.rpcId !== undefined ? ` #${m.rpcId}` : ''
            }`
            let body: string
            try {
                body = JSON.stringify(m.payload, null, 2)
            } catch {
                body = String(m.payload)
            }
            return `${head}\n${body}`
        })
        .join('\n\n')
}

async function copyToClipboard(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text)
            return
        } catch {
            // fall through to textarea fallback
        }
    }
    // Fallback for permission-denied or non-secure contexts: a hidden
    // textarea + execCommand('copy'). Modern browsers still honor this when
    // the action is user-initiated.
    if (typeof document === 'undefined') return
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    try {
        document.execCommand('copy')
    } finally {
        ta.remove()
    }
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div className='text-muted-foreground flex h-full items-center justify-center p-6 text-xs'>
            {children}
        </div>
    )
}

function summarizeRpc(msg: LspRpcMessage): string | null {
    // Cheap one-liner for the row header: pull a recognizable URI, label,
    // or message field when present so the log is browsable without
    // expanding every row.
    const payload = msg.payload as Record<string, unknown> | null
    if (!payload) return null
    const params = payload.params as Record<string, unknown> | undefined
    const result = payload.result
    const error = payload.error as { message?: string } | undefined
    if (error?.message) return error.message
    if (params) {
        const td = params.textDocument as { uri?: string } | undefined
        if (td?.uri) return relativeUri(td.uri)
        if (typeof params.uri === 'string') return relativeUri(params.uri)
        if (typeof params.message === 'string') return params.message
        if (Array.isArray((params as { contentChanges?: unknown[] }).contentChanges)) {
            const td2 = params.textDocument as { uri?: string } | undefined
            return td2?.uri ? relativeUri(td2.uri) : null
        }
    }
    if (typeof result === 'object' && result !== null) {
        const r = result as { capabilities?: unknown }
        if (r.capabilities) return 'capabilities'
    }
    return null
}

function relativeUri(uri: string): string {
    return uri.startsWith('file://') ? uri.slice('file://'.length) : uri
}

function formatJsonPretty(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

const padZero = (n: number) => n.toString().padStart(2, '0')

function formatTime(ts: number): string {
    const d = new Date(ts)
    return `${padZero(d.getHours())}:${padZero(d.getMinutes())}:${padZero(d.getSeconds())}`
}

export const lspLogTool: ToolDefinition = {
    kind: LSP_LOG_TOOL_KIND,
    title: 'LSP',
    icon: <ScrollTextIcon />,
    defaultLocation: 'bottom',
    render: () => <LspLogPane />,
}
