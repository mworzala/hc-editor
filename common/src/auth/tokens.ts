import { canonicalHtu, v1AuthToken, type HCClient } from '@hollowcube/api'

import { buildClientKeyProof } from './dpop'
import type { ClientKeyStore } from './keystore'

// In-memory access-token lifecycle for the active session. Tokens are never
// persisted. Refresh mints via /v1/auth/token, PoP-signed with the CLIENT key
// (not the access token) — that endpoint is public w.r.t. access-token
// injection, so there's no recursion through the auth hook.
//
// Access tokens are opaque, ~15 min TTL, second-quantized (two mints in the
// same wall-clock second return the SAME string). We never parse the token and
// drive refresh off `accessExpiresAt`, not off token identity.

const EXPIRY_SKEW_MS = 30_000

export interface ActiveSession {
    account: string
    sessionId: string
}

export interface TokenManager {
    /** Best-known access token for the active session, minting/refreshing if
     *  none is cached or it's within the expiry skew. Null when there's no
     *  active session or minting failed. */
    getAccessToken(): Promise<string | null>
    /** 401 handler for HCClient.send(): force a single-flight refresh and
     *  return the new token (or null → re-auth required). */
    onUnauthorized(): Promise<string | null>
    /** Switch the active session. `initialToken`/`initialExpiresAt` seed the
     *  cache (redeem returns an access token directly — no immediate mint). */
    setActiveSession(
        session: ActiveSession | null,
        initialToken?: string,
        initialExpiresAt?: string,
    ): void
    getActiveAccount(): string | null
}

export interface TokenManagerDeps {
    /** Lazy client accessor — breaks the AuthProvider construction cycle
     *  (client needs the auth hook, the hook needs this manager). */
    getClient(): HCClient
    keyStore: ClientKeyStore
    /** Invoked when refresh fails for the still-active session. */
    onNeedsReauth?(account: string): void
}

const parseExpiry = (rfc3339: string): number => {
    const ms = Date.parse(rfc3339)
    return Number.isNaN(ms) ? 0 : ms
}

export function createTokenManager(deps: TokenManagerDeps): TokenManager {
    let active: ActiveSession | null = null
    let token: string | null = null
    let expiresAtMs: number | null = null
    let refreshInFlight: Promise<string | null> | null = null

    const mint = async (): Promise<string | null> => {
        if (!active) return null
        const session = active
        try {
            const { privateKey } = await deps.keyStore.getOrCreate()
            const publicJwk = await deps.keyStore.exportPublicJwk()
            const client = deps.getClient()
            // Client-key proof (no `ath`). htu must equal the public origin
            // Envoy reconstructs — same canonicalizer as protected calls.
            const proof = await buildClientKeyProof({
                privateKey,
                publicJwk,
                htm: 'POST',
                htu: canonicalHtu(`${client.baseUrl}/v1/auth/token`),
            })
            const res = await v1AuthToken(client, { sessionId: session.sessionId }, proof)
            // Ignore a refresh that resolved after the active session changed.
            if (active && active.sessionId === session.sessionId) {
                token = res.accessToken
                expiresAtMs = parseExpiry(res.accessExpiresAt)
            }
            return res.accessToken
        } catch {
            if (active && active.sessionId === session.sessionId) {
                token = null
                expiresAtMs = null
                deps.onNeedsReauth?.(session.account)
            }
            return null
        }
    }

    // Single-flight: concurrent refreshes (parallel 401s, or expiry + 401)
    // coalesce into one round-trip.
    const refresh = (): Promise<string | null> => {
        if (!refreshInFlight) {
            refreshInFlight = mint().finally(() => {
                refreshInFlight = null
            })
        }
        return refreshInFlight
    }

    const isFresh = (): boolean =>
        token !== null && expiresAtMs !== null && Date.now() < expiresAtMs - EXPIRY_SKEW_MS

    return {
        getAccessToken: async () => (isFresh() ? token : await refresh()),
        onUnauthorized: refresh,
        setActiveSession: (session, initialToken, initialExpiresAt) => {
            active = session
            token = initialToken ?? null
            expiresAtMs = initialToken && initialExpiresAt ? parseExpiry(initialExpiresAt) : null
        },
        getActiveAccount: () => active?.account ?? null,
    }
}
