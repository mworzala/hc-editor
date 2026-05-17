import { describe, expect, test } from 'bun:test'

import type { HCClient } from '@hollowcube/api'

import type { ClientKeyStore } from '../platform'
import { redeemLaunchCode } from './redeem'
import { createMemorySessionStore } from './sessionstore'

async function fakeKeyStore(): Promise<ClientKeyStore> {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
    ])) as CryptoKeyPair
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
    return {
        getOrCreate: async () => pair,
        exportPublicJwk: async () => jwk,
        thumbprint: async () => 'test-kid',
    }
}

type RequestFn = (method: string, path: string, opts?: unknown) => Promise<unknown>

function fakeClient(request: RequestFn): HCClient {
    return { baseUrl: 'https://api.test', request } as unknown as HCClient
}

const OK_RESPONSE = {
    accessToken: 'acc-tok',
    accessExpiresAt: '2099-01-01T00:00:00Z',
    sessionId: 'sess-1',
    account: { id: 'acct-1', username: 'bob' },
}

describe('redeemLaunchCode', () => {
    test('ok → persists session and returns the access token + expiry', async () => {
        const sessionStore = createMemorySessionStore()
        const out = await redeemLaunchCode('ok-code', {
            client: fakeClient(async () => OK_RESPONSE),
            keyStore: await fakeKeyStore(),
            sessionStore,
            clientKind: 'web',
        })
        expect(out).toEqual({
            status: 'ok',
            session: {
                account: 'acct-1',
                sessionId: 'sess-1',
                accountMeta: { id: 'acct-1', username: 'bob' },
            },
            accessToken: 'acc-tok',
            accessExpiresAt: '2099-01-01T00:00:00Z',
        })
        expect(await sessionStore.get('acct-1')).not.toBeNull()
    })

    test('concurrent calls with the same code redeem exactly once', async () => {
        let calls = 0
        const deps = {
            client: fakeClient(async () => {
                calls += 1
                await new Promise((r) => setTimeout(r, 20))
                return OK_RESPONSE
            }),
            keyStore: await fakeKeyStore(),
            sessionStore: createMemorySessionStore(),
            clientKind: 'web' as const,
        }
        const [a, b] = await Promise.all([
            redeemLaunchCode('dup-code', deps),
            redeemLaunchCode('dup-code', deps),
        ])
        expect(calls).toBe(1)
        expect(a).toEqual(b)
        // in-flight entry cleared after settle → a fresh attempt re-redeems
        await redeemLaunchCode('dup-code', deps)
        expect(calls).toBe(2)
    })

    test('redeem failure (generic 401 / network) → error outcome', async () => {
        const boom = new Error('unauthorized')
        const out = await redeemLaunchCode('err-code', {
            client: fakeClient(async () => {
                throw boom
            }),
            keyStore: await fakeKeyStore(),
            sessionStore: createMemorySessionStore(),
            clientKind: 'desktop',
        })
        expect(out).toEqual({ status: 'error', error: boom })
    })
})
