import { canonicalHtu, v1AuthRedeem, type ClientKind, type HCClient } from '@hollowcube/api'

import { buildClientKeyProof } from './dpop'
import type { ClientKeyStore } from './keystore'
import type { SessionStore, StoredSession } from './types'

export type RedeemOutcome =
    | {
          status: 'ok'
          session: StoredSession
          accessToken: string
          accessExpiresAt: string
          /** Project the launch grant opened from in-game. `null` when the
           *  grant carried no project — the caller renders the
           *  "open from in-game" screen rather than a stale project. */
          project: string | null
      }
    | { status: 'error'; error: unknown }

export interface RedeemDeps {
    client: HCClient
    keyStore: ClientKeyStore
    sessionStore: SessionStore
    clientKind: ClientKind
}

// Module-level in-flight map keyed by launch code. Survives React StrictMode
// double-mount and any duplicate dispatch: both callers await the same
// promise, so the single-use code is redeemed exactly once per process.
const inFlight = new Map<string, Promise<RedeemOutcome>>()

async function doRedeem(code: string, deps: RedeemDeps): Promise<RedeemOutcome> {
    try {
        const { privateKey } = await deps.keyStore.getOrCreate()
        const publicJwk = await deps.keyStore.exportPublicJwk()
        // Client-key proof (no `ath`). htu must equal the public origin Envoy
        // reconstructs — derived from the client's base URL via the shared
        // canonicalizer.
        const htu = canonicalHtu(`${deps.client.baseUrl}/v1/auth/redeem`)
        const proof = await buildClientKeyProof({
            privateKey,
            publicJwk,
            htm: 'POST',
            htu,
        })
        const res = await v1AuthRedeem(
            deps.client,
            { launchCode: code, clientKind: deps.clientKind },
            proof,
        )
        const session: StoredSession = {
            account: res.account.id,
            sessionId: res.sessionId,
            accountMeta: res.account,
        }
        await deps.sessionStore.save(session)
        return {
            status: 'ok',
            session,
            accessToken: res.accessToken,
            accessExpiresAt: res.accessExpiresAt,
            project: res.project ?? null,
        }
    } catch (err) {
        // Redeem failure is a generic 401 (bad proof OR expired/used code) —
        // indistinguishable by contract. The caller falls back to any stored
        // session.
        console.error('[redeem] exchange failed', err)
        return { status: 'error', error: err }
    }
}

export function redeemLaunchCode(code: string, deps: RedeemDeps): Promise<RedeemOutcome> {
    let promise = inFlight.get(code)
    if (!promise) {
        promise = doRedeem(code, deps).finally(() => {
            inFlight.delete(code)
        })
        inFlight.set(code, promise)
    }
    return promise
}
