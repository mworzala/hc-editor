import type { z } from 'zod'

import { v1ProjectEvents } from './endpoints/v1-project-events'
import { v1ProjectFilesDelete } from './endpoints/v1-project-files-delete'
import { v1ProjectFilesGet } from './endpoints/v1-project-files-get'
import { v1ProjectFilesUpdate } from './endpoints/v1-project-files-update'
import { v1ProjectGet } from './endpoints/v1-project-get'
import { ApiError } from './error'

export interface HCClientLike {
    client: HCClient
}

export type HCMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

export interface HCClientOptions {
    baseUrl: string
    fetch?: typeof fetch
}

export interface HCRequestOptions<T = unknown> {
    body?: BodyInit
    headers?: HeadersInit
    response?: z.ZodType<T>
    signal?: AbortSignal
}

export class HCClient {
    readonly baseUrl: string
    readonly fetch: typeof fetch

    #v1: HCV1Client | null = null

    constructor(opts: HCClientOptions) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/u, '')
        this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
    }

    get v1(): HCV1Client {
        return (this.#v1 ??= new HCV1Client(this))
    }

    async request<T = unknown>(
        method: HCMethod,
        path: `/${string}`,
        options?: HCRequestOptions<T>,
    ): Promise<T> {
        const response = await this.send(method, path, options)
        if (response.status === 204) return undefined as T
        const data = await response.json()
        if (options?.response) {
            const parsed = options.response.safeParse(data)
            if (!parsed.success) {
                throw new Error(`Response validation failed: ${parsed.error.message}`)
            }
            return parsed.data
        }
        return data as T
    }

    // Low-level: returns the Response without parsing. Throws ApiError on non-2xx.
    // Used for binary endpoints and SSE streams.
    async send(
        method: HCMethod,
        path: `/${string}`,
        options?: Omit<HCRequestOptions, 'response'>,
    ): Promise<Response> {
        const url = `${this.baseUrl}${path}`
        let response: Response
        try {
            response = await this.fetch(url, {
                method,
                body: options?.body,
                headers: options?.headers,
                signal: options?.signal,
            })
        } catch (cause) {
            // Preserve user-initiated cancellation untouched so consumers can
            // distinguish abort from a real failure.
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
            throw ApiError.network(method, url, cause)
        }
        if (!response.ok) throw await ApiError.fromResponse(response, { method, url })
        return response
    }
}

export class HCV1Client {
    readonly client: HCClient

    #project: HCV1ProjectClient | null = null

    constructor(client: HCClient) {
        this.client = client
    }

    get project(): HCV1ProjectClient {
        return (this.#project ??= new HCV1ProjectClient(this))
    }
}

export class HCV1ProjectClient implements HCClientLike {
    readonly client: HCClient

    #files: HCV1ProjectFilesClient | null = null

    constructor(parent: HCV1Client) {
        this.client = parent.client
    }

    get = (projectId: string) => v1ProjectGet(this.client, projectId)

    events = (projectId: string, opts?: { lastEventId?: string; signal?: AbortSignal }) =>
        v1ProjectEvents(this.client, projectId, opts)

    get files(): HCV1ProjectFilesClient {
        return (this.#files ??= new HCV1ProjectFilesClient(this))
    }
}

export class HCV1ProjectFilesClient implements HCClientLike {
    readonly client: HCClient

    constructor(parent: HCV1ProjectClient) {
        this.client = parent.client
    }

    get = (projectId: string, path: string) => v1ProjectFilesGet(this.client, projectId, path)

    update = (projectId: string, path: string, body: BodyInit, contentType?: string) =>
        v1ProjectFilesUpdate(this.client, projectId, path, body, contentType)

    delete = (projectId: string, path: string) => v1ProjectFilesDelete(this.client, projectId, path)
}
