import type { z } from 'zod'

import { v1MapEditorBootstrap } from './endpoints/v1-map-editor-bootstrap'
import { v1MapEditorEvents } from './endpoints/v1-map-editor-events'
import { v1MapFilesDelete } from './endpoints/v1-map-files-delete'
import { v1MapFilesGet, type MapFilesGetConditions } from './endpoints/v1-map-files-get'
import { v1MapFilesUpdate } from './endpoints/v1-map-files-update'
import type { MapFilesWriteConditions } from './endpoints/v1-map-files-write'
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
    /** Per-request timeout in ms. Omitted → {@link DEFAULT_TIMEOUT_MS}.
     *  `null` → no timeout (long-lived streams like SSE must pass this). */
    timeoutMs?: number | null
    /** Bounded transient retry. Defaults on for idempotent `GET`, off for
     *  everything else. Pass `false` to opt a `GET` out (the SSE connect does
     *  — `events.tsx` owns its own reconnect/backoff and the two must not
     *  compound). */
    retry?: boolean
    /** Non-2xx statuses the caller will handle itself instead of having
     *  `send()` throw an {@link ApiError}. Used for conditional requests:
     *  `304` on a `If-None-Match` GET and `412` on a failed `If-Match` /
     *  `If-None-Match: *` precondition are control flow, not errors. */
    allowedStatuses?: readonly number[]
}

/** Default client-side request deadline. A stalled connection against real
 *  infra would otherwise hang a save/load forever with no error and no UI. */
export const DEFAULT_TIMEOUT_MS = 25_000

const MAX_ATTEMPTS = 3
const BACKOFF_CAP_MS = 20_000

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

        const userSignal = options?.signal
        const timeoutMs = options?.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs

        // One network call. A fresh timeout is armed per attempt so every
        // retry gets a full budget, while the caller's signal spans all of
        // them. A timeout abort is mapped to a flagged ApiError; a caller
        // abort passes through untouched as cancellation, not an error.
        const attempt = async (headers: Headers): Promise<Response> => {
            const timeoutSignal =
                typeof timeoutMs === 'number' && timeoutMs > 0
                    ? AbortSignal.timeout(timeoutMs)
                    : null
            const signal =
                userSignal && timeoutSignal
                    ? AbortSignal.any([userSignal, timeoutSignal])
                    : (timeoutSignal ?? userSignal)

            let response: Response
            try {
                response = await this.fetch(url, { method, body: options?.body, headers, signal })
            } catch (cause) {
                if (timeoutSignal?.aborted && !userSignal?.aborted) {
                    throw ApiError.timeout(method, url, timeoutMs as number, cause)
                }
                // Preserve user-initiated cancellation untouched so consumers
                // can distinguish abort from a real failure.
                if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
                throw ApiError.network(method, url, cause)
            }
            if (!response.ok && !options?.allowedStatuses?.includes(response.status)) {
                throw await ApiError.fromResponse(response, { method, url })
            }
            return response
        }

        // Single 401 → refresh-once → retry. Refresh single-flight lives in
        // the token manager behind onUnauthorized(); this is the only place
        // that handles 401 (request()/SSE sit above send()).
        const once = async (): Promise<Response> => {
            const initialToken = auth && applyAuth ? await auth.getAccessToken() : null
            try {
                return await attempt(await composeHeaders(initialToken))
            } catch (err) {
                if (!auth || !applyAuth || !(err instanceof ApiError) || err.status !== 401) {
                    throw err
                }
                const refreshed = await auth.onUnauthorized()
                if (refreshed === null) throw err
                return await attempt(await composeHeaders(refreshed))
            }
        }

        // Bounded transient retry for idempotent GETs only. Writes
        // (PUT/POST/DELETE) are surfaced immediately — never silently
        // re-applied. The 401→refresh path above is independent of this.
        const retryEnabled = method === 'GET' && options?.retry !== false
        const maxAttempts = retryEnabled ? MAX_ATTEMPTS : 1

        let lastErr: unknown
        for (let i = 0; i < maxAttempts; i++) {
            try {
                return await once()
            } catch (err) {
                lastErr = err
                if (i >= maxAttempts - 1 || !isTransient(err)) throw err
                // A caller-cancel during backoff stops the retries and
                // propagates the cancellation, not the transient error.
                await abortableDelay(backoffMs(i, err), userSignal)
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    }
}

/** Retryable iff no HTTP response or a transient server signal: network
 *  failure / timeout (status 0), 429, or any 5xx. 4xx (incl. the
 *  already-handled 401) are caller errors and never retried. */
function isTransient(err: unknown): boolean {
    return err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500)
}

/** Jittered exponential backoff, honoring a server `Retry-After` when present
 *  (clamped so a hostile value can't wedge the editor). */
function backoffMs(attemptIndex: number, err: unknown): number {
    if (err instanceof ApiError && err.retryAfterMs !== undefined) {
        return Math.min(err.retryAfterMs, BACKOFF_CAP_MS)
    }
    const base = Math.min(BACKOFF_CAP_MS, 300 * 2 ** attemptIndex)
    return base + Math.random() * 300
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('aborted', 'AbortError'))
            return
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(timer)
            reject(signal?.reason ?? new DOMException('aborted', 'AbortError'))
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

export class HCV1Client {
    readonly client: HCClient

    #map: HCV1MapClient | null = null

    constructor(client: HCClient) {
        this.client = client
    }

    get map(): HCV1MapClient {
        return (this.#map ??= new HCV1MapClient(this))
    }
}

export class HCV1MapClient implements HCClientLike {
    readonly client: HCClient

    #files: HCV1MapFilesClient | null = null

    constructor(parent: HCV1Client) {
        this.client = parent.client
    }

    editorBootstrap = (mapId: string) => v1MapEditorBootstrap(this.client, mapId)

    editorEvents = (mapId: string, opts?: { lastEventId?: string; signal?: AbortSignal }) =>
        v1MapEditorEvents(this.client, mapId, opts)

    get files(): HCV1MapFilesClient {
        return (this.#files ??= new HCV1MapFilesClient(this))
    }
}

export class HCV1MapFilesClient implements HCClientLike {
    readonly client: HCClient

    constructor(parent: HCV1MapClient) {
        this.client = parent.client
    }

    get = (mapId: string, path: string, opts?: MapFilesGetConditions) =>
        v1MapFilesGet(this.client, mapId, path, opts)

    update = (
        mapId: string,
        path: string,
        body: BodyInit,
        contentType?: string,
        opts?: MapFilesWriteConditions,
    ) => v1MapFilesUpdate(this.client, mapId, path, body, contentType, opts)

    delete = (mapId: string, path: string, opts?: MapFilesWriteConditions) =>
        v1MapFilesDelete(this.client, mapId, path, opts)
}
