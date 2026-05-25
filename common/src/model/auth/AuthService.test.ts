import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { HCClient } from '@hollowcube/api'

import type { Platform, LaunchCodeSource } from '../../platform'
import { createMemoryStorage } from '../../platform'
import { AuthService } from './AuthService'
import type { ClientKeyStore } from './keystore'
import { createMemorySessionStore } from './sessionstore'

// --- fakes ---

async function makeKeyStore(): Promise<ClientKeyStore> {
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

function makeLaunchSource(code: string | null): LaunchCodeSource {
    let taken = false
    return {
        take: () => {
            if (taken) return Promise.resolve(null)
            taken = true
            return Promise.resolve(code)
        },
    }
}

function makePlatform(over?: Partial<Platform>): Platform {
    return {
        kind: 'web',
        apiBaseUrl: 'https://api.test',
        storage: createMemoryStorage(),
        setWindowTitle: () => {},
        ...over,
    }
}

type RequestFn = (method: string, path: string, opts?: unknown) => Promise<unknown>

function makeClientFactory(request: RequestFn): {
    factory: NonNullable<ConstructorParameters<typeof AuthService>[0]['clientFactory']>
    client: HCClient
} {
    const client = { baseUrl: 'https://api.test', request } as unknown as HCClient
    return { factory: () => client, client }
}

function pumpMicrotasks(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0))
}

async function settle(svc: AuthService, max = 5): Promise<void> {
    // Spin a few microtask ticks so init()'s chained async work finishes.
    for (let i = 0; i < max; i++) {
        await pumpMicrotasks()
        const k = svc.status.peek().kind
        if (k !== 'initializing' && k !== 'redeeming') return
    }
}

const REDEEM_OK = {
    accessToken: 'tok',
    accessExpiresAt: '2099-01-01T00:00:00Z',
    sessionId: 'sess-1',
    account: { id: 'acct-1', username: 'bob' },
    project: 'project-1',
}

// --- tests ---

let keyStore: ClientKeyStore
let origError: typeof console.error

beforeEach(async () => {
    keyStore = await makeKeyStore()
    origError = console.error
    console.error = () => {}
})

afterEach(() => {
    console.error = origError
})

describe('AuthService — dev-dummy short-circuit', () => {
    test('immediately authenticates as dev-dummy, no launch-source read', async () => {
        const launchSource = makeLaunchSource('SHOULD-NOT-BE-READ')
        const { factory } = makeClientFactory(() => Promise.reject(new Error('no network')))
        const svc = new AuthService({
            platform: makePlatform({ devDummyAuth: true }),
            keyStore,
            sessionStore: createMemorySessionStore(),
            launchSource,
            clientFactory: factory,
        })
        await settle(svc)
        expect(svc.status.peek()).toEqual({ kind: 'authenticated', account: 'dev-dummy' })
        expect(svc.activeAccount.peek()).toBe('dev-dummy')
        expect(svc.grantedProject.peek()).toBeNull()
        svc.dispose()
    })
})

describe('AuthService — successful redeem', () => {
    test('init redeems the launch code, persists session, sets granted project', async () => {
        const sessionStore = createMemorySessionStore()
        const launchSource = makeLaunchSource('CODE-1')
        const { factory } = makeClientFactory((method, path) => {
            if (path === '/v1/auth/redeem') return Promise.resolve(REDEEM_OK)
            return Promise.reject(new Error(`unexpected ${method} ${path}`))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource,
            clientFactory: factory,
        })
        await settle(svc)
        const status = svc.status.peek()
        if (status.kind !== 'authenticated')
            throw new Error(`expected authenticated, got ${status.kind}`)
        expect(status.account).toBe('acct-1')
        expect(svc.activeAccount.peek()).toBe('acct-1')
        expect(svc.grantedProject.peek()).toBe('project-1')
        const sessions = svc.sessions.peek()
        expect(sessions).toHaveLength(1)
        expect(sessions[0]!.account).toBe('acct-1')
        expect(sessions[0]!.state).toBe('active')
        svc.dispose()
    })
})

describe('AuthService — redeem failure paths', () => {
    test('redeem failure with no stored sessions → error state', async () => {
        const launchSource = makeLaunchSource('BAD-CODE')
        const { factory } = makeClientFactory((_method, path) => {
            if (path === '/v1/auth/redeem') return Promise.reject(new Error('401 unauthorized'))
            return Promise.reject(new Error('unexpected'))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore: createMemorySessionStore(),
            launchSource,
            clientFactory: factory,
        })
        await settle(svc)
        expect(svc.status.peek().kind).toBe('error')
        svc.dispose()
    })

    test('redeem failure with stored sessions → falls back to picking', async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'acct-existing',
            sessionId: 'sess-existing',
            accountMeta: { id: 'acct-existing', username: 'alice' },
        })
        await sessionStore.save({
            account: 'acct-other',
            sessionId: 'sess-other',
            accountMeta: { id: 'acct-other', username: 'bob' },
        })
        const launchSource = makeLaunchSource('BAD-CODE')
        const { factory } = makeClientFactory((_method, path) => {
            if (path === '/v1/auth/redeem') return Promise.reject(new Error('401 unauthorized'))
            return Promise.reject(new Error('unexpected'))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource,
            clientFactory: factory,
        })
        await settle(svc)
        // Multiple sessions → picking.
        expect(svc.status.peek().kind).toBe('picking')
        expect(svc.sessions.peek().map((s) => s.account)).toEqual(['acct-existing', 'acct-other'])
        svc.dispose()
    })
})

describe('AuthService — resume from store (no launch code)', () => {
    test('single stored session auto-authenticates when token mints', async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'acct-single',
            sessionId: 'sess-single',
            accountMeta: { id: 'acct-single', username: 'alice' },
        })
        const { factory } = makeClientFactory((_method, path) => {
            if (path === '/v1/auth/token') {
                return Promise.resolve({
                    accessToken: 'tok',
                    accessExpiresAt: '2099-01-01T00:00:00Z',
                })
            }
            return Promise.reject(new Error(`unexpected ${path}`))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        const status = svc.status.peek()
        if (status.kind !== 'authenticated') throw new Error(`got ${status.kind}`)
        expect(status.account).toBe('acct-single')
        expect(svc.grantedProject.peek()).toBeNull()
        svc.dispose()
    })

    test('multiple stored sessions → picking', async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'a1',
            sessionId: 's1',
            accountMeta: { id: 'a1', username: 'x' },
        })
        await sessionStore.save({
            account: 'a2',
            sessionId: 's2',
            accountMeta: { id: 'a2', username: 'y' },
        })
        const { factory } = makeClientFactory(() => Promise.reject(new Error('unexpected')))
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        expect(svc.status.peek().kind).toBe('picking')
        expect(svc.sessions.peek()).toHaveLength(2)
        svc.dispose()
    })

    test('no stored sessions, no launch code → unauthenticated', async () => {
        const { factory } = makeClientFactory(() => Promise.reject(new Error('unexpected')))
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore: createMemorySessionStore(),
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        expect(svc.status.peek().kind).toBe('unauthenticated')
        svc.dispose()
    })
})

describe('AuthService — switchAccount', () => {
    test('mints a token for the target session and transitions to authenticated', async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'a1',
            sessionId: 's1',
            accountMeta: { id: 'a1', username: 'x' },
        })
        await sessionStore.save({
            account: 'a2',
            sessionId: 's2',
            accountMeta: { id: 'a2', username: 'y' },
        })
        const { factory } = makeClientFactory((_m, path) => {
            if (path === '/v1/auth/token') {
                return Promise.resolve({
                    accessToken: 'tok',
                    accessExpiresAt: '2099-01-01T00:00:00Z',
                })
            }
            return Promise.reject(new Error('unexpected'))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        expect(svc.status.peek().kind).toBe('picking')
        await svc.switchAccount('a2')
        const status = svc.status.peek()
        if (status.kind !== 'authenticated') throw new Error(`got ${status.kind}`)
        expect(status.account).toBe('a2')
        expect(svc.activeAccount.peek()).toBe('a2')
        svc.dispose()
    })

    test('token-mint failure marks the account needs-reauth, status returns to picking', async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'a1',
            sessionId: 's1',
            accountMeta: { id: 'a1', username: 'x' },
        })
        await sessionStore.save({
            account: 'a2',
            sessionId: 's2',
            accountMeta: { id: 'a2', username: 'y' },
        })
        const { factory } = makeClientFactory((_m, path) => {
            if (path === '/v1/auth/token') return Promise.reject(new Error('refresh failed'))
            return Promise.reject(new Error('unexpected'))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        await svc.switchAccount('a1')
        expect(svc.status.peek().kind).toBe('picking')
        const sessions = svc.sessions.peek()
        const a1 = sessions.find((s) => s.account === 'a1')!
        expect(a1.state).toBe('needs-reauth')
        svc.dispose()
    })
})

describe('AuthService — signOut', () => {
    test("signOut('all') clears everything; status → unauthenticated", async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'a1',
            sessionId: 's1',
            accountMeta: { id: 'a1', username: 'x' },
        })
        const { factory } = makeClientFactory((_m, path) => {
            if (path === '/v1/auth/token') {
                return Promise.resolve({
                    accessToken: 'tok',
                    accessExpiresAt: '2099-01-01T00:00:00Z',
                })
            }
            return Promise.reject(new Error('unexpected'))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        await svc.signOut('all')
        expect(svc.status.peek().kind).toBe('unauthenticated')
        expect(svc.activeAccount.peek()).toBeNull()
        expect(svc.sessions.peek()).toEqual([])
        svc.dispose()
    })

    test('signOut(account) removes one session and resolves remaining', async () => {
        const sessionStore = createMemorySessionStore()
        await sessionStore.save({
            account: 'a1',
            sessionId: 's1',
            accountMeta: { id: 'a1', username: 'x' },
        })
        await sessionStore.save({
            account: 'a2',
            sessionId: 's2',
            accountMeta: { id: 'a2', username: 'y' },
        })
        const { factory } = makeClientFactory((_m, path) => {
            if (path === '/v1/auth/token') {
                return Promise.resolve({
                    accessToken: 'tok',
                    accessExpiresAt: '2099-01-01T00:00:00Z',
                })
            }
            return Promise.reject(new Error('unexpected'))
        })
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore,
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        await settle(svc)
        await svc.signOut('a2')
        // Now one session remains; resolve falls back to single-session path.
        const status = svc.status.peek()
        // Resolution outcome depends on token mint success — fixture mints
        // successfully → authenticated as a1.
        if (status.kind === 'authenticated') {
            expect(status.account).toBe('a1')
        } else {
            expect(status.kind).toBe('picking')
        }
        expect(svc.sessions.peek().map((s) => s.account)).toEqual(['a1'])
        svc.dispose()
    })
})

describe('AuthService — disposal', () => {
    test('dispose is idempotent and blocks further state transitions', async () => {
        const { factory } = makeClientFactory(() => Promise.reject(new Error('unexpected')))
        const svc = new AuthService({
            platform: makePlatform(),
            keyStore,
            sessionStore: createMemorySessionStore(),
            launchSource: makeLaunchSource(null),
            clientFactory: factory,
        })
        svc.dispose()
        svc.dispose()
        await pumpMicrotasks()
        // Status remains the initial initializing — late init resolution is
        // a no-op because _disposed is set.
        expect(svc.status.peek().kind).toBe('initializing')
    })
})
