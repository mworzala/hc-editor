import { beforeEach, describe, expect, test } from 'bun:test'

import type { HCClient } from '@hollowcube/api'

import type { ClientKeyStore } from './keystore'
import { createTokenManager } from './tokens'

async function fakeKeyStore(): Promise<ClientKeyStore> {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
    ])) as CryptoKeyPair
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
    return {
        getOrCreate: () => Promise.resolve(pair),
        exportPublicJwk: () => Promise.resolve(jwk),
        thumbprint: () => Promise.resolve('test-kid'),
    }
}

type RequestFn = (method: string, path: string, opts?: unknown) => Promise<unknown>

function fakeClient(request: RequestFn): HCClient {
    return { baseUrl: 'https://api.test', request } as unknown as HCClient
}

let keyStore: ClientKeyStore

beforeEach(async () => {
    keyStore = await fakeKeyStore()
})

const FUTURE = '2099-01-01T00:00:00Z'
const tokenRes = (accessToken: string) => ({ accessToken, accessExpiresAt: FUTURE })

describe('token manager', () => {
    test('no active session → null, no token request', async () => {
        let calls = 0
        const tm = createTokenManager({
            getClient: () => fakeClient(() => ((calls += 1), Promise.resolve(tokenRes('x')))),
            keyStore,
        })
        expect(await tm.getAccessToken()).toBeNull()
        expect(calls).toBe(0)
    })

    test('initialToken + expiry seeds the cache without a mint', async () => {
        let calls = 0
        const tm = createTokenManager({
            getClient: () => fakeClient(() => ((calls += 1), Promise.resolve(tokenRes('minted')))),
            keyStore,
        })
        tm.setActiveSession({ account: 'a', sessionId: 's' }, 'seed-token', FUTURE)
        expect(await tm.getAccessToken()).toBe('seed-token')
        expect(calls).toBe(0)
        expect(tm.getActiveAccount()).toBe('a')
    })

    test('mints on first access then caches while fresh', async () => {
        let calls = 0
        const tm = createTokenManager({
            getClient: () =>
                fakeClient(() => {
                    calls += 1
                    return Promise.resolve(tokenRes(`tok-${calls}`))
                }),
            keyStore,
        })
        tm.setActiveSession({ account: 'a', sessionId: 's' })
        expect(await tm.getAccessToken()).toBe('tok-1')
        expect(await tm.getAccessToken()).toBe('tok-1')
        expect(calls).toBe(1)
    })

    test('a past accessExpiresAt forces a re-mint on next access', async () => {
        let calls = 0
        const tm = createTokenManager({
            getClient: () =>
                fakeClient(() => {
                    calls += 1
                    return Promise.resolve({
                        accessToken: `tok-${calls}`,
                        accessExpiresAt: '2000-01-01T00:00:00Z',
                    })
                }),
            keyStore,
        })
        tm.setActiveSession({ account: 'a', sessionId: 's' })
        expect(await tm.getAccessToken()).toBe('tok-1')
        // expired immediately → next access re-mints rather than serving stale
        expect(await tm.getAccessToken()).toBe('tok-2')
        expect(calls).toBe(2)
    })

    test('concurrent refreshes are single-flight', async () => {
        let calls = 0
        const tm = createTokenManager({
            getClient: () =>
                fakeClient(async () => {
                    calls += 1
                    await new Promise((r) => setTimeout(r, 20))
                    return tokenRes('shared')
                }),
            keyStore,
        })
        tm.setActiveSession({ account: 'a', sessionId: 's' })
        const [a, b, c] = await Promise.all([
            tm.onUnauthorized(),
            tm.onUnauthorized(),
            tm.onUnauthorized(),
        ])
        expect([a, b, c]).toEqual(['shared', 'shared', 'shared'])
        expect(calls).toBe(1)
    })

    test('refresh failure → null + onNeedsReauth, retried on next access', async () => {
        let calls = 0
        let fail = true
        const reauthed: string[] = []
        const tm = createTokenManager({
            getClient: () =>
                fakeClient(() => {
                    calls += 1
                    if (fail) return Promise.reject(new Error('token endpoint 401'))
                    return Promise.resolve(tokenRes('recovered'))
                }),
            keyStore,
            onNeedsReauth: (acc) => reauthed.push(acc),
        })
        tm.setActiveSession({ account: 'acc-1', sessionId: 's' })
        expect(await tm.getAccessToken()).toBeNull()
        expect(reauthed).toEqual(['acc-1'])
        // in-flight cleared → a later access re-attempts (recovers here)
        fail = false
        expect(await tm.getAccessToken()).toBe('recovered')
        expect(calls).toBe(2)
    })

    test('switching session away mid-refresh does not cache the stale token', async () => {
        const tm = createTokenManager({
            getClient: () =>
                fakeClient(async () => {
                    await new Promise((r) => setTimeout(r, 20))
                    return tokenRes('stale')
                }),
            keyStore,
        })
        tm.setActiveSession({ account: 'a', sessionId: 's' })
        const pending = tm.getAccessToken()
        tm.setActiveSession(null)
        await pending
        expect(tm.getActiveAccount()).toBeNull()
        expect(await tm.getAccessToken()).toBeNull()
    })
})
