// `AuthService` — model-layer home for the auth orchestration that
// previously lived inside `<AuthProvider>` (common/src/auth/context.tsx).
// Wraps the existing plain-TS plumbing (`createTokenManager`,
// `createIndexedDbSessionStore`, `createWebCryptoKeyStore`,
// `redeemLaunchCode`, `buildDpopProof`, `createHashLaunchCodeSource`)
// verbatim — there's no behavioral change, just a shift from React state
// to signals and from a hook tree to a class on `EditorApp`.
//
// Init runs in the constructor: state-machine guards + redeem.ts's
// module-level in-flight map make double-firing safe under React
// StrictMode. The HCClient is constructed inside the service and exposed
// via `EditorApp.client` (a getter that returns `app.auth.client`).

import { HCClient, type HCAuthHook } from '@hollowcube/api'

import type { LaunchCodeSource, Platform } from '../../platform'
import { computed, signal, type ReadonlySignal, type Signal } from '../foundation/signal'
import { buildDpopProof } from './dpop'
import { createWebCryptoKeyStore, type ClientKeyStore } from './keystore'
import { createHashLaunchCodeSource } from './launch-code'
import { redeemLaunchCode } from './redeem'
import { createIndexedDbSessionStore } from './sessionstore'
import { createTokenManager, type TokenManager } from './tokens'
import type { AuthStatus, Session, SessionStore, StoredSession } from './types'

export interface AuthServiceDeps {
    platform: Platform
    /** Test seam. Defaults to the production WebCrypto store. */
    keyStore?: ClientKeyStore
    /** Test seam. Defaults to the production IndexedDB store. */
    sessionStore?: SessionStore
    /** Test seam. Defaults to the platform's launchCode source (or the
     *  web hash source when none is provided and platform.kind === 'web'). */
    launchSource?: LaunchCodeSource | undefined
    /** Test seam. Lets a fake HCClient be injected without going through
     *  the production constructor. */
    clientFactory?: (opts: {
        baseUrl: string
        auth: HCAuthHook
        fetch?: typeof globalThis.fetch
    }) => HCClient
}

export class AuthService {
    readonly client: HCClient

    private readonly _status: Signal<AuthStatus> = signal<AuthStatus>({ kind: 'initializing' })
    private readonly _storedSessions: Signal<readonly StoredSession[]> = signal([])
    private readonly _activeAccount: Signal<string | null> = signal(null)
    private readonly _grantedProject: Signal<string | null> = signal(null)
    private readonly _needsReauth: Signal<ReadonlySet<string>> = signal(new Set())

    readonly status: ReadonlySignal<AuthStatus> = this._status
    readonly activeAccount: ReadonlySignal<string | null> = this._activeAccount
    readonly grantedProject: ReadonlySignal<string | null> = this._grantedProject

    /** Sessions decorated with runtime `state: 'active' | 'needs-reauth'`. */
    readonly sessions: ReadonlySignal<readonly Session[]> = computed(() => {
        const stored = this._storedSessions.value
        const needs = this._needsReauth.value
        return stored.map((s) => ({
            ...s,
            state: needs.has(s.account) ? 'needs-reauth' : 'active',
        }))
    })

    private readonly _keyStore: ClientKeyStore
    private readonly _sessionStore: SessionStore
    private readonly _launchSource: LaunchCodeSource | undefined
    private readonly _tokenManager: TokenManager
    private readonly _platform: Platform
    private _disposed = false

    constructor(deps: AuthServiceDeps) {
        const { platform } = deps
        this._platform = platform
        this._keyStore = deps.keyStore ?? createWebCryptoKeyStore()
        this._sessionStore = deps.sessionStore ?? createIndexedDbSessionStore()
        this._launchSource =
            deps.launchSource !== undefined
                ? deps.launchSource
                : (platform.launchCode ??
                  (platform.kind === 'web' ? createHashLaunchCodeSource() : undefined))

        this._tokenManager = createTokenManager({
            getClient: () => {
                if (!this.client) throw new Error('auth: HCClient accessed before init')
                return this.client
            },
            keyStore: this._keyStore,
            onNeedsReauth: (account) => this._handleNeedsReauth(account),
        })

        const dummyAuth = platform.devDummyAuth === true
        const tokenManager = this._tokenManager
        const keyStore = this._keyStore
        const authHook: HCAuthHook = {
            getAccessToken: () =>
                dummyAuth ? Promise.resolve('dev-dummy-token') : tokenManager.getAccessToken(),
            onUnauthorized: () =>
                dummyAuth ? Promise.resolve('dev-dummy-token') : tokenManager.onUnauthorized(),
            createProof: async (method, htu, accessToken) => {
                if (dummyAuth) return 'dev-dummy-proof'
                const { privateKey } = await keyStore.getOrCreate()
                const publicJwk = await keyStore.exportPublicJwk()
                return buildDpopProof({ privateKey, publicJwk, htm: method, htu, accessToken })
            },
            isPublic: (path) => path === '/v1/auth/redeem' || path === '/v1/auth/token',
        }

        const devAuthUser = platform.devAuthUser
        const stampedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers)
            if (!headers.has('x-auth-user')) headers.set('x-auth-user', devAuthUser!)
            return globalThis.fetch(input, { ...init, headers })
        }
        const fetchImpl = devAuthUser ? (stampedFetch as typeof fetch) : undefined

        const factory =
            deps.clientFactory ??
            ((opts) =>
                new HCClient({
                    baseUrl: opts.baseUrl,
                    auth: opts.auth,
                    fetch: opts.fetch,
                }))
        this.client = factory({
            baseUrl: platform.apiBaseUrl ?? '',
            auth: authHook,
            fetch: fetchImpl,
        })

        // Kick off the launch/redeem flow. Fire-and-forget — UI gates on
        // `status` signal. Idempotent if init() is ever called twice.
        void this.init()
    }

    /** Run the launch → redeem → session-resolve flow. Idempotent during
     *  a single run (state-machine guard); re-callable on retry from
     *  `error` via `redeemFromLaunch()`. */
    async init(): Promise<void> {
        if (this._disposed) return
        try {
            this._status.value = { kind: 'initializing' }

            if (this._platform.devDummyAuth) {
                this._grantedProject.value = null
                this._activeAccount.value = 'dev-dummy'
                this._status.value = { kind: 'authenticated', account: 'dev-dummy' }
                return
            }

            await this._keyStore.getOrCreate()

            const code = (await this._launchSource?.take()) ?? null
            if (code) {
                this._status.value = { kind: 'redeeming' }
                const outcome = await redeemLaunchCode(code, {
                    client: this.client,
                    keyStore: this._keyStore,
                    sessionStore: this._sessionStore,
                    clientKind: this._platform.kind,
                })
                if (this._disposed) return
                if (outcome.status === 'ok') {
                    this._tokenManager.setActiveSession(
                        {
                            account: outcome.session.account,
                            sessionId: outcome.session.sessionId,
                        },
                        outcome.accessToken,
                        outcome.accessExpiresAt,
                    )
                    this._grantedProject.value = outcome.project
                    this._storedSessions.value = await this._sessionStore.list()
                    this._activeAccount.value = outcome.session.account
                    this._status.value = {
                        kind: 'authenticated',
                        account: outcome.session.account,
                    }
                    return
                }
                console.error('[auth] init: redeem failed', outcome.error)
                const fallback = await this._sessionStore.list()
                if (fallback.length === 0) {
                    console.error(
                        '[auth] init: no stored sessions to fall back to — surfacing error',
                    )
                    this._status.value = { kind: 'error', error: outcome.error }
                    return
                }
            }
            await this._resolveFromStore()
        } catch (error) {
            console.error('[auth] init: unexpected error', error)
            if (!this._disposed) this._status.value = { kind: 'error', error }
        }
    }

    /** Re-run init — for error retry from the launcher / gate. */
    redeemFromLaunch(): Promise<void> {
        return this.init()
    }

    async switchAccount(account: string): Promise<void> {
        const target = this._storedSessions.peek().find((s) => s.account === account)
        if (!target) return
        this._tokenManager.setActiveSession({
            account: target.account,
            sessionId: target.sessionId,
        })
        const token = await this._tokenManager.getAccessToken()
        if (this._disposed) return
        if (token) {
            const cur = this._needsReauth.peek()
            if (cur.has(account)) {
                const next = new Set(cur)
                next.delete(account)
                this._needsReauth.value = next
            }
            this._activeAccount.value = account
            this._status.value = { kind: 'authenticated', account }
        } else {
            this._needsReauth.value = new Set(this._needsReauth.peek()).add(account)
            this._status.value = { kind: 'picking' }
        }
    }

    async signOut(target: string | 'all'): Promise<void> {
        if (target === 'all') {
            await this._sessionStore.clear()
            this._tokenManager.setActiveSession(null)
            if (this._disposed) return
            this._storedSessions.value = []
            this._activeAccount.value = null
            this._needsReauth.value = new Set()
            this._status.value = { kind: 'unauthenticated' }
            return
        }
        await this._sessionStore.remove(target)
        if (this._disposed) return
        if (this._tokenManager.getActiveAccount() === target) {
            this._tokenManager.setActiveSession(null)
            this._activeAccount.value = null
        }
        await this._resolveFromStore()
    }

    dispose(): void {
        this._disposed = true
    }

    // --- internals ---

    private async _resolveFromStore(): Promise<void> {
        const stored = await this._sessionStore.list()
        if (this._disposed) return
        this._storedSessions.value = stored
        if (stored.length === 0) {
            this._status.value = { kind: 'unauthenticated' }
            return
        }
        if (stored.length === 1) {
            const only = stored[0]!
            this._tokenManager.setActiveSession({
                account: only.account,
                sessionId: only.sessionId,
            })
            const token = await this._tokenManager.getAccessToken()
            if (this._disposed) return
            if (token) {
                this._activeAccount.value = only.account
                this._status.value = { kind: 'authenticated', account: only.account }
            } else {
                this._needsReauth.value = new Set(this._needsReauth.peek()).add(only.account)
                this._status.value = { kind: 'picking' }
            }
            return
        }
        this._status.value = { kind: 'picking' }
    }

    private _handleNeedsReauth(account: string): void {
        this._needsReauth.value = new Set(this._needsReauth.peek()).add(account)
        const s = this._status.peek()
        if (s.kind === 'authenticated' && s.account === account) {
            this._status.value = { kind: 'picking' }
        }
        if (this._activeAccount.peek() === account) {
            this._activeAccount.value = null
        }
    }
}
