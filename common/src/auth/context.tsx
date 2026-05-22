import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react'

import { HCClient, type HCAuthHook } from '@hollowcube/api'

import { usePlatform } from '../platform'
import { setActiveProjectId } from './active-project'
import { buildDpopProof } from './dpop'
import { createWebCryptoKeyStore } from './keystore'
import { createHashLaunchCodeSource } from './launch-code'
import { redeemLaunchCode } from './redeem'
import { createIndexedDbSessionStore } from './sessionstore'
import { createTokenManager } from './tokens'
import type { AuthStatus, Session, StoredSession } from './types'

export interface AuthContextValue {
    status: AuthStatus
    sessions: Session[]
    activeAccount: string | null
    /** The HCClient wired with the DPoP auth hook — consumed by the workspace
     *  via <HCClientProvider>. */
    client: HCClient
    /** Re-run the launch/redeem/session-resolution flow (error retry). */
    redeemFromLaunch(): void
    /** Activate a stored session, minting an access token. */
    switchAccount(account: string): Promise<void>
    /** Forget a stored session locally (single account or all). The contract
     *  has no server logout endpoint — the session lapses on its own; this
     *  just drops the local record + in-memory token. */
    signOut(target: string | 'all'): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>')
    return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const platform = usePlatform()

    const [status, setStatus] = useState<AuthStatus>({ kind: 'initializing' })
    const [sessions, setSessions] = useState<StoredSession[]>([])
    const [activeAccount, setActiveAccount] = useState<string | null>(null)
    const [needsReauth, setNeedsReauth] = useState<ReadonlySet<string>>(new Set())

    // Stable, ref-backed so the (memoized) token manager can call the latest
    // state setters without being recreated.
    const onNeedsReauthRef = useRef<(account: string) => void>(() => {})
    onNeedsReauthRef.current = (account) => {
        setNeedsReauth((prev) => new Set(prev).add(account))
        setStatus((s) =>
            s.kind === 'authenticated' && s.account === account ? { kind: 'picking' } : s,
        )
        setActiveAccount((a) => (a === account ? null : a))
    }

    const clientRef = useRef<HCClient | null>(null)
    const graph = useMemo(() => {
        const keyStore = platform.keyStore ?? createWebCryptoKeyStore()
        const sessionStore = createIndexedDbSessionStore()
        const launchSource =
            platform.launchCode ??
            (platform.kind === 'web' ? createHashLaunchCodeSource() : undefined)

        const tokenManager = createTokenManager({
            getClient: () => {
                const c = clientRef.current
                if (!c) throw new Error('auth: HCClient accessed before init')
                return c
            },
            keyStore,
            onNeedsReauth: (account) => onNeedsReauthRef.current(account),
        })

        const dummyAuth = platform.devDummyAuth === true
        const authHook: HCAuthHook = {
            // Dev-only short-circuit: skip DPoP / token manager and emit a
            // stub token + proof. The backend must run with a matching
            // auth-disable flag for these to be accepted.
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
            // redeem + token carry a client-key proof (no `ath`, no
            // Authorization) instead of the access token; skip injection for
            // those. Every other path is a protected call.
            isPublic: (path) => path === '/v1/auth/redeem' || path === '/v1/auth/token',
        }

        // Dev-only: when a fake user id is configured, stamp `x-auth-user`
        // on every outgoing request. The backend's auth-disabled mode reads
        // identity from this header instead of the access token, so pairing
        // it with `devDummyAuth` is the usual combination.
        const devAuthUser = platform.devAuthUser
        const stampedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers)
            if (!headers.has('x-auth-user')) headers.set('x-auth-user', devAuthUser!)
            return globalThis.fetch(input, { ...init, headers })
        }
        const fetchImpl = devAuthUser ? (stampedFetch as typeof fetch) : undefined

        const client = new HCClient({
            baseUrl: platform.apiBaseUrl ?? '',
            auth: authHook,
            fetch: fetchImpl,
        })
        clientRef.current = client
        return { keyStore, sessionStore, launchSource, tokenManager, client }
    }, [
        platform.apiBaseUrl,
        platform.keyStore,
        platform.launchCode,
        platform.kind,
        platform.devDummyAuth,
        platform.devAuthUser,
    ])

    const resolveFromStore = useCallback(async () => {
        const stored = await graph.sessionStore.list()
        setSessions(stored)
        if (stored.length === 0) {
            setStatus({ kind: 'unauthenticated' })
            return
        }
        if (stored.length === 1) {
            const only = stored[0]!
            graph.tokenManager.setActiveSession({
                account: only.account,
                sessionId: only.sessionId,
            })
            const token = await graph.tokenManager.getAccessToken()
            if (token) {
                setActiveAccount(only.account)
                setStatus({ kind: 'authenticated', account: only.account })
            } else {
                setNeedsReauth((prev) => new Set(prev).add(only.account))
                setStatus({ kind: 'picking' })
            }
            return
        }
        setStatus({ kind: 'picking' })
    }, [graph])

    const init = useCallback(async () => {
        try {
            setStatus({ kind: 'initializing' })

            // Dev-only short-circuit: skip the whole launch/redeem/token
            // dance and declare ourselves authenticated. Pairs with the
            // dummy auth hook above and a matching backend auth-disable
            // flag. Without an override map id there's nothing to open, so
            // the gate will still show "open from in-game".
            if (platform.devDummyAuth) {
                setActiveProjectId(platform.devMapIdOverride ?? null)
                setActiveAccount('dev-dummy')
                setStatus({ kind: 'authenticated', account: 'dev-dummy' })
                return
            }

            // Ensure the client keypair exists before any proof is built.
            await graph.keyStore.getOrCreate()

            const code = (await graph.launchSource?.take()) ?? null
            if (code) {
                setStatus({ kind: 'redeeming' })
                const outcome = await redeemLaunchCode(code, {
                    client: graph.client,
                    keyStore: graph.keyStore,
                    sessionStore: graph.sessionStore,
                    clientKind: platform.kind,
                })
                if (outcome.status === 'ok') {
                    graph.tokenManager.setActiveSession(
                        {
                            account: outcome.session.account,
                            sessionId: outcome.session.sessionId,
                        },
                        outcome.accessToken,
                        outcome.accessExpiresAt,
                    )
                    // Stash the granted map (per-tab) BEFORE flipping to
                    // `authenticated` so the gate observes it on the same
                    // render. `null` → gate shows "open from in-game". A dev
                    // override beats the granted project so local testing
                    // can pin a specific map regardless of which launch
                    // code was used.
                    setActiveProjectId(platform.devMapIdOverride ?? outcome.project)
                    setSessions(await graph.sessionStore.list())
                    setActiveAccount(outcome.session.account)
                    setStatus({ kind: 'authenticated', account: outcome.session.account })
                    return
                }
                // Redeem failed (generic 401 — bad proof or used/expired
                // code). If we already have stored sessions, fall back to the
                // launcher; otherwise surface the error.
                console.error('[auth] init: redeem failed', outcome.error)
                if ((await graph.sessionStore.list()).length === 0) {
                    console.error(
                        '[auth] init: no stored sessions to fall back to — surfacing error',
                    )
                    setStatus({ kind: 'error', error: outcome.error })
                    return
                }
            }
            // On the resume path, apply the dev override so a stored
            // session opens the override map instead of whatever was
            // last granted.
            if (platform.devMapIdOverride) {
                setActiveProjectId(platform.devMapIdOverride)
            }
            await resolveFromStore()
        } catch (error) {
            console.error('[auth] init: unexpected error', error)
            setStatus({ kind: 'error', error })
        }
    }, [graph, resolveFromStore, platform.kind, platform.devDummyAuth, platform.devMapIdOverride])

    // Run once. The ref guard covers the React StrictMode dev double-invoke;
    // the launch-code source strip + redeem in-flight map are the deeper
    // single-use guarantees.
    const started = useRef(false)
    useEffect(() => {
        if (started.current) return
        started.current = true
        void init()
    }, [init])

    const switchAccount = useCallback(
        async (account: string) => {
            const target = sessions.find((s) => s.account === account)
            if (!target) return
            graph.tokenManager.setActiveSession({
                account: target.account,
                sessionId: target.sessionId,
            })
            const token = await graph.tokenManager.getAccessToken()
            if (token) {
                setNeedsReauth((prev) => {
                    if (!prev.has(account)) return prev
                    const next = new Set(prev)
                    next.delete(account)
                    return next
                })
                setActiveAccount(account)
                setStatus({ kind: 'authenticated', account })
            } else {
                setNeedsReauth((prev) => new Set(prev).add(account))
                setStatus({ kind: 'picking' })
            }
        },
        [graph, sessions],
    )

    const signOut = useCallback(
        async (target: string | 'all') => {
            // Local only — no server logout endpoint in the contract. The
            // session lapses by its idle/absolute window; dropping the local
            // record + token is enough for the UI.
            if (target === 'all') {
                await graph.sessionStore.clear()
                graph.tokenManager.setActiveSession(null)
                setSessions([])
                setActiveAccount(null)
                setNeedsReauth(new Set())
                setStatus({ kind: 'unauthenticated' })
                return
            }
            await graph.sessionStore.remove(target)
            if (graph.tokenManager.getActiveAccount() === target) {
                graph.tokenManager.setActiveSession(null)
                setActiveAccount(null)
            }
            await resolveFromStore()
        },
        [graph, resolveFromStore],
    )

    const value = useMemo<AuthContextValue>(() => {
        const derived: Session[] = sessions.map((s) => ({
            ...s,
            state: needsReauth.has(s.account) ? 'needs-reauth' : 'active',
        }))
        return {
            status,
            sessions: derived,
            activeAccount,
            client: graph.client,
            redeemFromLaunch: () => void init(),
            switchAccount,
            signOut,
        }
    }, [status, sessions, needsReauth, activeAccount, graph, init, switchAccount, signOut])

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
