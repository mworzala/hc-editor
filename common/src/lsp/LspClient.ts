// Editor-agnostic JSON-RPC client for the luau-lsp wasm worker. Drives the
// document lifecycle and exposes a small public API consumers (CodeMirror
// extensions, command bridges) call.
//
// We intentionally do NOT use any third-party LSP client package. The wire is
// plain JSON-RPC and the worker handles the wasm side; pulling in
// vscode-languageclient or codemirror-languageserver would either bring dozens
// of @codingame/* packages or strip features we support.

import type { Diagnostic, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'

import { SERVER_REQUESTS_TO_NULL_OUT, clientCapabilities, type JsonRpcMessage } from './protocol'

export type LspState = 'starting' | 'running' | 'stopped' | 'failed'

export type LspLogLevel = 'error' | 'warn' | 'info' | 'log' | 'debug'

export type LspLogMessage = {
    id: number
    level: LspLogLevel
    message: string
    timestamp: number
    show: boolean
}

export type LspRpcDirection = 'client→server' | 'server→client'

export type LspRpcMessage = {
    id: number
    /** Direction of the frame on the wire. */
    direction: LspRpcDirection
    timestamp: number
    /** Frame shape: request expects a response, notification doesn't, response
     *  is a reply to a request, error is a failed reply. */
    kind: 'request' | 'response' | 'notification' | 'error'
    /** Method name when known. Responses carry the method of the matching
     *  request so the log can group request/response pairs together. */
    method?: string
    /** JSON-RPC id when present. */
    rpcId?: number | string
    /** The full frame as it was sent or received, for verbose drill-down. */
    payload: unknown
}

const LOG_LEVELS: LspLogLevel[] = ['log', 'error', 'warn', 'info', 'log', 'debug']
const LOG_BUFFER_LIMIT = 1000
const RPC_BUFFER_LIMIT = 2000

export type LspStartFile = {
    uri: string
    languageId: string
    text: string
}

export type LspTraceLevel = 'off' | 'messages' | 'verbose'

export type LspStartOptions = {
    /** Map of `@alias/` prefix to absolute path. Forwarded to the worker upstream of `start()`. */
    aliases?: Record<string, string>
    /** Files to didOpen up-front so the wasm has bytes to read on require resolution. */
    files?: LspStartFile[]
    /** Synthetic definition file paths set via `luau-lsp.types.definitionFiles`. */
    definitionFiles?: string[]
    /** LSP trace level. Default `'off'`. */
    trace?: LspTraceLevel
}

export type DiagnosticsListener = (uri: string, diagnostics: Diagnostic[]) => void

export type ApplyWorkspaceEditHandler = (edit: WorkspaceEdit) => boolean | Promise<boolean>

export type ServerCapabilities = {
    semanticTokensProvider?: {
        legend: { tokenTypes: string[]; tokenModifiers: string[] }
    }
    documentOnTypeFormattingProvider?: {
        firstTriggerCharacter: string
        moreTriggerCharacter?: string[]
    }
    completionProvider?: {
        triggerCharacters?: string[]
        resolveProvider?: boolean
    }
    signatureHelpProvider?: {
        triggerCharacters?: string[]
        retriggerCharacters?: string[]
    }
    executeCommandProvider?: {
        commands: string[]
    }
}

type Pending = (msg: JsonRpcMessage) => void

type TrackedDocument = { version: number }

type PublishDiagnosticsParams = {
    uri: string
    version?: number
    diagnostics: Diagnostic[]
}

export class LspClient {
    private state: LspState = 'starting'
    private stateListeners = new Set<(state: LspState) => void>()
    private nextRequestId = 1
    private pending = new Map<number, Pending>()
    private documents = new Map<string, TrackedDocument>()
    private capabilities: ServerCapabilities | null = null
    private workerErrorListener: ((e: ErrorEvent) => void) | null = null
    private workerMessageListener: ((e: MessageEvent) => void) | null = null
    private settings: Record<string, unknown> = {}
    private logMessages: LspLogMessage[] = []
    private nextLogId = 1
    private logListeners = new Set<(messages: readonly LspLogMessage[]) => void>()
    private rpcMessages: LspRpcMessage[] = []
    private nextRpcId = 1
    private rpcListeners = new Set<(messages: readonly LspRpcMessage[]) => void>()
    /** Tracks the method name for each outstanding outbound request so we
     *  can attach it to the response frame when it arrives. */
    private requestMethods = new Map<number, string>()
    private diagnosticsListeners = new Set<DiagnosticsListener>()
    private latestDiagnostics = new Map<string, Diagnostic[]>()
    private applyWorkspaceEditHandler: ApplyWorkspaceEditHandler | null = null

    private worker: Worker

    constructor(worker: Worker) {
        this.worker = worker
    }

    getCapabilities(): ServerCapabilities | null {
        return this.capabilities
    }

    getState(): LspState {
        return this.state
    }

    onStateChange(cb: (state: LspState) => void): () => void {
        this.stateListeners.add(cb)
        return () => {
            this.stateListeners.delete(cb)
        }
    }

    private setState(state: LspState): void {
        if (this.state === state) return
        this.state = state
        for (const cb of this.stateListeners) cb(state)
    }

    getLogMessages(): readonly LspLogMessage[] {
        return this.logMessages
    }

    onLogMessage(cb: (messages: readonly LspLogMessage[]) => void): () => void {
        this.logListeners.add(cb)
        return () => {
            this.logListeners.delete(cb)
        }
    }

    clearLogMessages(): void {
        if (this.logMessages.length === 0) return
        this.logMessages = []
        for (const cb of this.logListeners) cb(this.logMessages)
    }

    private appendLogMessage(level: LspLogLevel, message: string, show: boolean): void {
        const entry: LspLogMessage = {
            id: this.nextLogId++,
            level,
            message,
            timestamp: Date.now(),
            show,
        }
        const next = this.logMessages.concat(entry)
        if (next.length > LOG_BUFFER_LIMIT) next.splice(0, next.length - LOG_BUFFER_LIMIT)
        this.logMessages = next
        for (const cb of this.logListeners) cb(this.logMessages)
    }

    getRpcMessages(): readonly LspRpcMessage[] {
        return this.rpcMessages
    }

    onRpcMessage(cb: (messages: readonly LspRpcMessage[]) => void): () => void {
        this.rpcListeners.add(cb)
        return () => {
            this.rpcListeners.delete(cb)
        }
    }

    clearRpcMessages(): void {
        if (this.rpcMessages.length === 0) return
        this.rpcMessages = []
        for (const cb of this.rpcListeners) cb(this.rpcMessages)
    }

    private appendRpcMessage(entry: Omit<LspRpcMessage, 'id' | 'timestamp'>): void {
        const full: LspRpcMessage = {
            id: this.nextRpcId++,
            timestamp: Date.now(),
            ...entry,
        }
        const next = this.rpcMessages.concat(full)
        if (next.length > RPC_BUFFER_LIMIT) next.splice(0, next.length - RPC_BUFFER_LIMIT)
        this.rpcMessages = next
        for (const cb of this.rpcListeners) cb(this.rpcMessages)
    }

    onDiagnostics(
        cb: DiagnosticsListener,
        options: { replay?: boolean } = {},
    ): () => void {
        const replay = options.replay ?? true
        this.diagnosticsListeners.add(cb)
        if (replay) {
            for (const [uri, diags] of this.latestDiagnostics) cb(uri, diags)
        }
        return () => {
            this.diagnosticsListeners.delete(cb)
        }
    }

    getDiagnostics(uri: string): Diagnostic[] {
        return this.latestDiagnostics.get(uri) ?? []
    }

    setApplyWorkspaceEditHandler(handler: ApplyWorkspaceEditHandler | null): void {
        this.applyWorkspaceEditHandler = handler
    }

    async start(options: LspStartOptions = {}): Promise<void> {
        this.workerMessageListener = (e: MessageEvent) => this.handleMessage(e.data)
        this.workerErrorListener = (e: ErrorEvent) => {
            console.error('[lsp] worker error', e.message, e.error)
            this.setState('failed')
        }
        this.worker.addEventListener('message', this.workerMessageListener)
        this.worker.addEventListener('error', this.workerErrorListener)

        const trace: LspTraceLevel = options.trace ?? 'off'
        this.settings = {
            'luau-lsp': {
                trace: { server: trace },
                types: options.definitionFiles
                    ? { definitionFiles: options.definitionFiles }
                    : undefined,
            },
        }
        // Aliases are NOT pushed via this channel; the worker mounts a virtual
        // /.luaurc the resolver reads via fopen. See LuauLspContext for wiring.
        void options.aliases

        try {
            const initResult = (await this.request('initialize', {
                processId: null,
                clientInfo: { name: 'hollowcube-editor' },
                rootUri: 'file:///',
                workspaceFolders: [{ uri: 'file:///', name: 'project' }],
                capabilities: clientCapabilities(),
                initializationOptions: this.settings,
                trace,
            })) as { capabilities?: ServerCapabilities }
            this.capabilities = initResult.capabilities ?? {}
            this.notify('initialized', {})
            this.notify('workspace/didChangeConfiguration', { settings: this.settings })
            this.notify('$/setTrace', { value: trace })
        } catch (err) {
            console.error('[lsp] initialize failed', err)
            this.setState('failed')
            return
        }

        for (const file of options.files ?? []) {
            if (this.documents.has(file.uri)) continue
            this.documents.set(file.uri, { version: 1 })
            this.notify('textDocument/didOpen', {
                textDocument: {
                    uri: file.uri,
                    languageId: file.languageId,
                    version: 1,
                    text: file.text,
                },
            })
        }

        this.setState('running')
    }

    sendRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
        return this.request(method, params) as Promise<T>
    }

    sendNotification(method: string, params?: unknown): void {
        this.notify(method, params)
    }

    executeCommand<T = unknown>(command: string, commandArgs?: unknown[] | unknown): Promise<T> {
        const args = Array.isArray(commandArgs)
            ? commandArgs
            : commandArgs !== undefined
              ? [commandArgs]
              : undefined
        return this.request('workspace/executeCommand', { command, arguments: args }) as Promise<T>
    }

    openDocument(uri: string, languageId: string, text: string): void {
        if (this.documents.has(uri)) return
        this.documents.set(uri, { version: 1 })
        this.notify('textDocument/didOpen', {
            textDocument: { uri, languageId, version: 1, text },
        })
    }

    didChange(uri: string, text: string): void {
        const tracked = this.documents.get(uri)
        if (!tracked) return
        tracked.version += 1
        this.notify('textDocument/didChange', {
            textDocument: { uri, version: tracked.version },
            contentChanges: [{ text }],
        })
    }

    closeDocument(uri: string): void {
        if (!this.documents.has(uri)) return
        this.documents.delete(uri)
        this.notify('textDocument/didClose', { textDocument: { uri } })
        if (this.latestDiagnostics.has(uri)) {
            this.latestDiagnostics.set(uri, [])
            for (const cb of this.diagnosticsListeners) cb(uri, [])
            this.latestDiagnostics.delete(uri)
        }
    }

    async stop(): Promise<void> {
        if (this.state === 'stopped') return
        try {
            await this.request('shutdown', null)
            this.notify('exit')
        } catch {
            // ignore — the wasm may already be torn down
        }

        this.documents.clear()
        if (this.workerMessageListener)
            this.worker.removeEventListener('message', this.workerMessageListener)
        if (this.workerErrorListener)
            this.worker.removeEventListener('error', this.workerErrorListener)
        this.workerMessageListener = null
        this.workerErrorListener = null
        this.pending.clear()
        this.setState('stopped')
    }

    // === JSON-RPC core ===

    /** Wrap every outbound `worker.postMessage` so RPC frames land in the
     *  message log. The log captures the same JSON the worker receives, so
     *  drill-down shows exactly what was on the wire. */
    private sendToWorker(
        frame: JsonRpcMessage,
        kind: LspRpcMessage['kind'],
        method?: string,
    ): void {
        this.worker.postMessage(frame)
        this.appendRpcMessage({
            direction: 'client→server',
            kind,
            method: method ?? frame.method,
            rpcId: frame.id,
            payload: frame,
        })
    }

    private notify(method: string, params?: unknown): void {
        const msg: JsonRpcMessage = { jsonrpc: '2.0', method, params }
        this.sendToWorker(msg, 'notification', method)
    }

    private request(method: string, params?: unknown): Promise<unknown> {
        const id = this.nextRequestId++
        return new Promise((resolve, reject) => {
            this.pending.set(id, (msg) => {
                if (msg.error) reject(new Error(`${method} failed: ${msg.error.message}`))
                else resolve(msg.result)
            })
            this.requestMethods.set(id, method)
            this.sendToWorker({ jsonrpc: '2.0', id, method, params }, 'request', method)
        })
    }

    private handleMessage(raw: unknown): void {
        if (typeof raw !== 'object' || raw === null) return
        const msg = raw as JsonRpcMessage

        // Categorize the inbound frame for the message log before dispatching.
        const inboundKind: LspRpcMessage['kind'] =
            msg.error !== undefined
                ? 'error'
                : msg.id !== undefined && msg.method === undefined
                  ? 'response'
                  : msg.method !== undefined && msg.id !== undefined
                    ? 'request'
                    : 'notification'
        const inboundMethod =
            msg.method ??
            (typeof msg.id === 'number' ? this.requestMethods.get(msg.id) : undefined)
        this.appendRpcMessage({
            direction: 'server→client',
            kind: inboundKind,
            method: inboundMethod,
            rpcId: msg.id,
            payload: msg,
        })
        if (inboundKind === 'response' || inboundKind === 'error') {
            if (typeof msg.id === 'number') this.requestMethods.delete(msg.id)
        }

        if (msg.id !== undefined && msg.method === undefined) {
            const cb = this.pending.get(msg.id as number)
            if (cb) {
                this.pending.delete(msg.id as number)
                cb(msg)
            }
            return
        }

        if (msg.method && msg.id === undefined) {
            switch (msg.method) {
                case 'textDocument/publishDiagnostics': {
                    const params = msg.params as PublishDiagnosticsParams
                    this.latestDiagnostics.set(params.uri, params.diagnostics)
                    for (const cb of this.diagnosticsListeners) cb(params.uri, params.diagnostics)
                    return
                }
                case 'window/logMessage':
                case 'window/showMessage': {
                    const p = msg.params as { type: number; message: string }
                    const level = LOG_LEVELS[p.type] ?? 'log'
                    this.appendLogMessage(level, p.message, msg.method === 'window/showMessage')
                    return
                }
                default:
                    return
            }
        }

        if (msg.method && msg.id !== undefined) {
            const id = msg.id
            switch (msg.method) {
                case 'workspace/configuration': {
                    const params = msg.params as {
                        items: { section?: string; scopeUri?: string }[]
                    }
                    const items = params?.items ?? []
                    const result = items.map((item) => this.lookupConfigSection(item.section))
                    this.sendToWorker(
                        { jsonrpc: '2.0', id, result },
                        'response',
                        'workspace/configuration',
                    )
                    return
                }
                case 'workspace/applyEdit': {
                    const params = msg.params as { label?: string; edit: WorkspaceEdit }
                    void this.dispatchWorkspaceEdit(params.edit).then((applied) => {
                        this.sendToWorker(
                            { jsonrpc: '2.0', id, result: { applied } },
                            'response',
                            'workspace/applyEdit',
                        )
                        return undefined
                    })
                    return
                }
                default:
                    if (SERVER_REQUESTS_TO_NULL_OUT.has(msg.method)) {
                        this.sendToWorker(
                            { jsonrpc: '2.0', id, result: null },
                            'response',
                            msg.method,
                        )
                    } else {
                        this.sendToWorker(
                            {
                                jsonrpc: '2.0',
                                id,
                                error: {
                                    code: -32601,
                                    message: `Method not found: ${msg.method}`,
                                },
                            },
                            'error',
                            msg.method,
                        )
                    }
                    return
            }
        }
    }

    private lookupConfigSection(section: string | undefined): unknown {
        if (!section) return this.settings
        const parts = section.split('.')
        let cur: unknown = this.settings
        for (const part of parts) {
            if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
                cur = (cur as Record<string, unknown>)[part]
            } else {
                return null
            }
        }
        return cur
    }

    private async dispatchWorkspaceEdit(edit: WorkspaceEdit): Promise<boolean> {
        if (!edit) return false
        if (!this.applyWorkspaceEditHandler) return false
        try {
            return await this.applyWorkspaceEditHandler(edit)
        } catch (err) {
            console.error('[lsp] applyWorkspaceEdit handler threw', err)
            return false
        }
    }
}

/** Helper: collect all { uri, edits } pairs from a WorkspaceEdit. */
export function flattenWorkspaceEdit(edit: WorkspaceEdit): { uri: string; edits: TextEdit[] }[] {
    const out: { uri: string; edits: TextEdit[] }[] = []
    if (edit.changes) {
        for (const [uri, edits] of Object.entries(edit.changes)) {
            out.push({ uri, edits })
        }
    }
    if (edit.documentChanges) {
        for (const change of edit.documentChanges) {
            if ('textDocument' in change) {
                out.push({ uri: change.textDocument.uri, edits: change.edits as TextEdit[] })
            }
        }
    }
    return out
}
