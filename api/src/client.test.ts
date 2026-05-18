import { describe, expect, test } from 'bun:test'

import { HCClient } from './client'
import { ApiError } from './error'

// Just the call signature — Bun's `typeof fetch` also requires `preconnect`,
// which a test double has no reason to implement.
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function makeClient(fetchImpl: FetchLike) {
    return new HCClient({
        baseUrl: 'https://api.test',
        fetch: fetchImpl as unknown as typeof fetch,
    })
}

// 503 with `Retry-After: 0` so the backoff resolves immediately — keeps the
// retry tests deterministic and fast without a fake-timer harness.
function transient(status: number): Response {
    return new Response(JSON.stringify({ error: 'boom' }), {
        status,
        headers: { 'Retry-After': '0' },
    })
}

describe('HCClient — STAB-2 transient retry', () => {
    test('retries an idempotent GET on 503 up to 3 attempts, then surfaces it', async () => {
        let calls = 0
        const client = makeClient(async () => {
            calls += 1
            return transient(503)
        })
        const err = await client.send('GET', '/x').catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(503)
        expect(calls).toBe(3)
    })

    test('retries on 429 (transient) and succeeds once the server recovers', async () => {
        let calls = 0
        const client = makeClient(async () => {
            calls += 1
            return calls < 2 ? transient(429) : new Response('ok', { status: 200 })
        })
        const res = await client.send('GET', '/x')
        expect(res.status).toBe(200)
        expect(calls).toBe(2)
    })

    test('retries a GET on a network error', async () => {
        let calls = 0
        const client = makeClient(async () => {
            calls += 1
            throw new TypeError('Failed to fetch')
        })
        const err = await client.send('GET', '/x').catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(0)
        expect(calls).toBe(3)
    })

    test('does NOT retry a non-idempotent PUT — write surfaces immediately', async () => {
        let calls = 0
        const client = makeClient(async () => {
            calls += 1
            return transient(503)
        })
        const err = await client.send('PUT', '/x', { body: 'data' }).catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect(calls).toBe(1)
    })

    test('does NOT retry a non-transient 404', async () => {
        let calls = 0
        const client = makeClient(async () => {
            calls += 1
            return new Response('', { status: 404 })
        })
        await client.send('GET', '/x').catch(() => {})
        expect(calls).toBe(1)
    })

    test('GET can opt out of retry via { retry: false } (SSE connect path)', async () => {
        let calls = 0
        const client = makeClient(async () => {
            calls += 1
            return transient(503)
        })
        await client.send('GET', '/x', { retry: false }).catch(() => {})
        expect(calls).toBe(1)
    })
})

// A fetch that never settles unless its signal aborts — models a stalled
// connection against real infra.
const stalled: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
        const signal = init?.signal
        const fail = () => reject(signal?.reason ?? new DOMException('aborted', 'AbortError'))
        // Mirror real fetch: reject synchronously if already aborted.
        if (signal?.aborted) {
            fail()
            return
        }
        signal?.addEventListener('abort', fail)
    })

describe('HCClient — STAB-1 request timeout', () => {
    test('a stalled request fails with a flagged timeout ApiError', async () => {
        const client = makeClient(stalled)
        const err = await client.send('GET', '/x', { timeoutMs: 20, retry: false }).catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(0)
        expect((err as ApiError).timedOut).toBe(true)
    })

    test('a caller-initiated abort passes through as cancellation, not an error', async () => {
        const client = makeClient(stalled)
        const ac = new AbortController()
        const p = client.send('GET', '/x', { signal: ac.signal, retry: false }).catch((e) => e)
        ac.abort()
        const err = await p
        expect(err).not.toBeInstanceOf(ApiError)
        expect(err).toBeInstanceOf(DOMException)
        expect((err as DOMException).name).toBe('AbortError')
    })
})

describe('HCClient — allowedStatuses (conditional-request control flow)', () => {
    test('a 304 passes through as a Response when listed in allowedStatuses', async () => {
        const client = makeClient(async () => new Response('', { status: 304 }))
        const res = await client.send('GET', '/x', { allowedStatuses: [304] })
        expect(res.status).toBe(304)
    })

    test('a 304 still throws an ApiError when NOT allowed', async () => {
        const client = makeClient(async () => new Response('', { status: 304 }))
        const err = await client.send('GET', '/x').catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(304)
    })

    test('a 412 precondition failure is NOT swallowed by an unrelated allow-list', async () => {
        const client = makeClient(async () => new Response('', { status: 412 }))
        const err = await client
            .send('PUT', '/x', { body: 'b', allowedStatuses: [304] })
            .catch((e) => e)
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(412)
    })
})

describe('HCClient — 401 refresh path is independent of transient retry', () => {
    test('a single 401 triggers one refresh-and-retry', async () => {
        let calls = 0
        let refreshed = 0
        const auth = {
            getAccessToken: async () => 'tok-1',
            createProof: async () => 'proof',
            isPublic: (_p: string) => false,
            onUnauthorized: async () => {
                refreshed += 1
                return 'tok-2'
            },
        }
        const impl: FetchLike = async (_url, _init) => {
            calls += 1
            return calls === 1
                ? new Response('', { status: 401 })
                : new Response('ok', { status: 200 })
        }
        const client = new HCClient({
            baseUrl: 'https://api.test',
            auth,
            fetch: impl as unknown as typeof fetch,
        })
        const res = await client.send('GET', '/x')
        expect(res.status).toBe(200)
        expect(refreshed).toBe(1)
        expect(calls).toBe(2)
    })
})
