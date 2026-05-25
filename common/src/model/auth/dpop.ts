import { base64url, calculateJwkThumbprint, SignJWT } from 'jose'
import type { JWK, JWTPayload } from 'jose'

// Pure DPoP / client-key proof helpers. No storage, no React — fully
// unit-testable in `bun test` (bun has WebCrypto `subtle`). jose accepts a
// WebCrypto CryptoKey directly, signs ES256 as raw r‖s (JOSE form — no DER),
// and emits compact JWS.

export interface DpopProofInput {
    /** Non-extractable client signing key (ECDSA P-256). */
    privateKey: CryptoKey
    /** Public JWK embedded in the proof header (no private fields). */
    publicJwk: JsonWebKey
    /** Uppercase HTTP method. */
    htm: string
    /** Canonical request URI (scheme://host/path, no query/fragment) — the
     *  caller derives this via api's `canonicalHtu` so there is exactly one
     *  canonicalization path. */
    htu: string
    /** When present, binds the proof to this access token via `ath`. Omit for
     *  the client-key proof used by redeem / token. */
    accessToken?: string
}

// jose's JWK ⊇ DOM JsonWebKey for EC public keys; the cast is structurally
// safe (kty/crv/x/y are the only fields that matter here).
const asJwk = (jwk: JsonWebKey): JWK => jwk as JWK

export async function buildDpopProof(input: DpopProofInput): Promise<string> {
    const { privateKey, publicJwk, htm, htu, accessToken } = input
    // jti: UUID, single-use (server rejects replays within 90s). iat: seconds,
    // must be within −90s/+30s of server time.
    const payload: JWTPayload = {
        jti: crypto.randomUUID(),
        htm,
        htu,
        iat: Math.floor(Date.now() / 1000),
    }
    if (accessToken !== undefined) {
        payload.ath = await sha256Base64Url(accessToken)
    }
    // typ/alg + embedded public JWK; server derives key_id from its RFC-7638
    // thumbprint. alg ES256 (ECDSA P-256); EdDSA also accepted but WebCrypto
    // Ed25519 is not reliable cross-browser.
    return new SignJWT(payload)
        .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: asJwk(publicJwk) })
        .sign(privateKey)
}

// Client-key proof for /v1/auth/redeem and /v1/auth/token — same construction
// as a DPoP proof but with no `ath` (there is no access token yet).
export const buildClientKeyProof = (input: Omit<DpopProofInput, 'accessToken'>): Promise<string> =>
    buildDpopProof(input)

// ath = base64url-no-pad SHA-256 of the exact access-token string (jose's
// base64url.encode is unpadded). Sent only on protected calls.
export async function sha256Base64Url(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return base64url.encode(new Uint8Array(digest))
}

// RFC 7638 SHA-256 JWK thumbprint, base64url no padding — the server derives
// the same value from the proof header's embedded jwk as the client key id.
export function jwkThumbprint(publicJwk: JsonWebKey): Promise<string> {
    return calculateJwkThumbprint(asJwk(publicJwk), 'sha256')
}
