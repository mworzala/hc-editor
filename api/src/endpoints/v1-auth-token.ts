import { z } from 'zod'

import type { HCClient } from '../client'

// Contract: POST /v1/auth/token (unauthenticated, DPoP-proofed). The "refresh"
// replacement — call before accessExpiresAt. Proof must be signed by the same
// client key used at redeem and omit `ath`.

export interface V1AuthTokenRequest {
    sessionId: string
}

export const V1AuthTokenResponseSchema = z.object({
    accessToken: z.string(),
    accessExpiresAt: z.string(),
})
export type V1AuthTokenResponse = z.infer<typeof V1AuthTokenResponseSchema>

// ---- Endpoint ----
// `proof` is a client-key compact JWS (no `ath`). This path is public w.r.t.
// access-token injection, so the caller-supplied DPoP header is preserved.

export const v1AuthToken = (
    client: HCClient,
    body: V1AuthTokenRequest,
    proof: string,
): Promise<V1AuthTokenResponse> =>
    client.request('POST', '/v1/auth/token', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', DPoP: proof },
        response: V1AuthTokenResponseSchema,
    })
