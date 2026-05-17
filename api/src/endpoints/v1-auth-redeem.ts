import { z } from 'zod'

import type { HCClient } from '../client'

// Contract: POST /v1/auth/redeem (unauthenticated, DPoP-proofed). The client
// key is carried in the DPoP proof header (server derives key_id from its
// RFC-7638 thumbprint) — NOT in the body. Proof must omit `ath`.

export type ClientKind = 'web' | 'desktop'

export interface V1AuthRedeemRequest {
    launchCode: string
    clientKind: ClientKind
    label?: string
}

export const AccountMetaSchema = z.object({
    id: z.string(),
    username: z.string(),
})
export type AccountMeta = z.infer<typeof AccountMetaSchema>

export const V1AuthRedeemResponseSchema = z.object({
    accessToken: z.string(),
    accessExpiresAt: z.string(),
    sessionId: z.string(),
    account: AccountMetaSchema,
    project: z.string().optional(),
})
export type V1AuthRedeemResponse = z.infer<typeof V1AuthRedeemResponseSchema>

// ---- Endpoint ----
// Imperative one-shot. `proof` is a client-key compact JWS (no `ath`); this
// path is public w.r.t. access-token injection so the caller-supplied DPoP
// header is preserved by HCClient.send().

export const v1AuthRedeem = (
    client: HCClient,
    body: V1AuthRedeemRequest,
    proof: string,
): Promise<V1AuthRedeemResponse> =>
    client.request('POST', '/v1/auth/redeem', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', DPoP: proof },
        response: V1AuthRedeemResponseSchema,
    })
