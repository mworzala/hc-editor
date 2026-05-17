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

// Injected by the auth module (the api package itself stays auth-agnostic and
// has no jose/crypto dependency). All four members are required so the client
// never has to reason about a half-configured hook.
export interface HCAuthHook {
    /** Current access token for the active session, or null if none yet. */
    getAccessToken(): Promise<string | null>
    /** Build a compact-JWS DPoP proof bound to this exact request. `htu` is
     *  already canonicalized by the client (scheme://host/path, no query) so
     *  there is exactly one canonicalization path. */
    createProof(method: string, htu: string, accessToken: string): Promise<string>
    /** Invoked once on a 401. Refresh the token (single-flight, owned by the
     *  token manager) and return the new token, or null if re-auth is needed. */
    onUnauthorized(): Promise<string | null>
    /** Paths that must NOT receive the access-token Authorization/DPoP pair —
     *  the auth endpoints carry their own client-key proof instead. */
    isPublic(path: string): boolean
}

export interface HCClientOptions {
    baseUrl: string
    fetch?: typeof fetch
    auth?: HCAuthHook
}

// FLAG(backend): htu MUST be scheme://host/path — lowercased host, default
// ports normalized, NO query/fragment/userinfo. The backend reconstructs this
// behind Envoy from forwarded headers; a mismatch here is the single most
// likely DPoP interop failure. Pin the exact canonical form with backend.
// `URL.origin` already lowercases the host and drops default ports; `pathname`
// excludes query and fragment; userinfo is part of neither.
export function canonicalHtu(url: string): string {
    const abs = new URL(url, globalThis.location?.origin ?? undefined)
    return abs.origin + abs.pathname
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

    readonly #auth: HCAuthHook | undefined

    #v1: HCV1Client | null = null

    constructor(opts: HCClientOptions) {
        this.baseUrl = opts.baseUrl.replace(/\/+$/u, '')
        this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
        this.#auth = opts.auth
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
        const auth = this.#auth
        const applyAuth = auth !== undefined && !auth.isPublic(path)

        // Caller headers win — never clobber a caller-supplied Authorization or
        // DPoP (the auth endpoints pass their own client-key proof this way).
        const baseHeaders = new Headers(options?.headers)
        const composeHeaders = async (token: string | null): Promise<Headers> => {
            const headers = new Headers(baseHeaders)
            if (auth && applyAuth && token !== null) {
                // FLAG(backend): `Authorization: DPoP <token>` + `DPoP: <jws>`,
                // one fresh proof per request.
                if (!headers.has('Authorization')) {
                    headers.set('Authorization', `DPoP ${token}`)
                }
                if (!headers.has('DPoP')) {
                    headers.set('DPoP', await auth.createProof(method, canonicalHtu(url), token))
                }
            }
            return headers
        }

        const attempt = async (headers: Headers): Promise<Response> => {
            let response: Response
            try {
                response = await this.fetch(url, {
                    method,
                    body: options?.body,
                    headers,
                    signal: options?.signal,
                })
            } catch (cause) {
                // Preserve user-initiated cancellation untouched so consumers
                // can distinguish abort from a real failure.
                if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
                throw ApiError.network(method, url, cause)
            }
            if (!response.ok) throw await ApiError.fromResponse(response, { method, url })
            return response
        }

        const initialToken = auth && applyAuth ? await auth.getAccessToken() : null
        try {
            return await attempt(await composeHeaders(initialToken))
        } catch (err) {
            // Single 401 → refresh-once → retry. Refresh single-flight lives in
            // the token manager behind onUnauthorized(); this is the only
            // retry site (request()/SSE sit above send()).
            if (!auth || !applyAuth || !(err instanceof ApiError) || err.status !== 401) {
                throw err
            }
            const refreshed = await auth.onUnauthorized()
            if (refreshed === null) throw err
            return await attempt(await composeHeaders(refreshed))
        }
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
