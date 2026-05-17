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

        const authHook: HCAuthHook = {
            getAccessToken: () => tokenManager.getAccessToken(),
            onUnauthorized: () => tokenManager.onUnauthorized(),
            createProof: async (method, htu, accessToken) => {
                const { privateKey } = await keyStore.getOrCreate()
                const publicJwk = await keyStore.exportPublicJwk()
                return buildDpopProof({ privateKey, publicJwk, htm: method, htu, accessToken })
            },
            // redeem + token carry a client-key proof (no `ath`, no
            // Authorization) instead of the access token; skip injection for
            // those. Every other path is a protected call.
            isPublic: (path) => path === '/v1/auth/redeem' || path === '/v1/auth/token',
        }

        const client = new HCClient({ baseUrl: platform.apiBaseUrl ?? '', auth: authHook })
        clientRef.current = client
        return { keyStore, sessionStore, launchSource, tokenManager, client }
    }, [platform.apiBaseUrl, platform.keyStore, platform.launchCode, platform.kind])

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
                    setSessions(await graph.sessionStore.list())
                    setActiveAccount(outcome.session.account)
                    setStatus({ kind: 'authenticated', account: outcome.session.account })
                    return
                }
                // Redeem failed (generic 401 — bad proof or used/expired
                // code). If we already have stored sessions, fall back to the
                // launcher; otherwise surface the error.
                if ((await graph.sessionStore.list()).length === 0) {
                    setStatus({ kind: 'error', error: outcome.error })
                    return
                }
            }
            await resolveFromStore()
        } catch (error) {
            setStatus({ kind: 'error', error })
        }
    }, [graph, resolveFromStore])

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
