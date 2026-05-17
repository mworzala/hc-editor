import { describe, expect, test } from 'bun:test'
import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify } from 'jose'

import { buildClientKeyProof, buildDpopProof, jwkThumbprint, sha256Base64Url } from './dpop'

async function freshKeyPair() {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
        'sign',
        'verify',
    ])) as CryptoKeyPair
    const publicJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
    return { pair, publicJwk }
}

const isBase64UrlNoPad = (s: string) => /^[A-Za-z0-9_-]+$/u.test(s)

describe('sha256Base64Url', () => {
    test('matches a Buffer-computed SHA-256, base64url unpadded', async () => {
        const got = await sha256Base64Url('abc')
        const want = Buffer.from(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc')),
        ).toString('base64url')
        expect(got).toBe(want)
        expect(isBase64UrlNoPad(got)).toBe(true)
    })
})

describe('jwkThumbprint', () => {
    test('is deterministic, unpadded base64url, and matches jose', async () => {
        const { publicJwk } = await freshKeyPair()
        const a = await jwkThumbprint(publicJwk)
        const b = await jwkThumbprint(publicJwk)
        expect(a).toBe(b)
        expect(isBase64UrlNoPad(a)).toBe(true)
        // FLAG(backend): key_id == RFC 7638 thumbprint — assert our helper
        // equals an independent jose computation over the same JWK.
        expect(a).toBe(await calculateJwkThumbprint(publicJwk as never, 'sha256'))
    })

    test('differs for different keys', async () => {
        const k1 = await freshKeyPair()
        const k2 = await freshKeyPair()
        expect(await jwkThumbprint(k1.publicJwk)).not.toBe(await jwkThumbprint(k2.publicJwk))
    })
})

describe('buildDpopProof', () => {
    test('emits a verifiable ES256 compact JWS with the right header + claims', async () => {
        const { pair, publicJwk } = await freshKeyPair()
        const proof = await buildDpopProof({
            privateKey: pair.privateKey,
            publicJwk,
            htm: 'POST',
            htu: 'https://api.example.com/v1/auth/token',
            accessToken: 'the-access-token',
        })

        expect(proof.split('.')).toHaveLength(3)

        const header = decodeProtectedHeader(proof)
        expect(header.typ).toBe('dpop+jwt')
        expect(header.alg).toBe('ES256')
        // Embedded public JWK must carry no private component.
        expect((header.jwk as Record<string, unknown>).d).toBeUndefined()
        expect((header.jwk as Record<string, unknown>).x).toBeDefined()

        const pub = await importJWK(publicJwk as never, 'ES256')
        const { payload } = await jwtVerify(proof, pub)
        expect(payload.htm).toBe('POST')
        expect(payload.htu).toBe('https://api.example.com/v1/auth/token')
        expect(typeof payload.jti).toBe('string')
        expect(typeof payload.iat).toBe('number')
        expect(payload.ath).toBe(await sha256Base64Url('the-access-token'))
    })

    test('client-key proof omits ath; jti is unique per call', async () => {
        const { pair, publicJwk } = await freshKeyPair()
        const input = {
            privateKey: pair.privateKey,
            publicJwk,
            htm: 'POST',
            htu: 'https://api.example.com/v1/auth/redeem',
        }
        const p1 = await buildClientKeyProof(input)
        const p2 = await buildClientKeyProof(input)

        const pub = await importJWK(publicJwk as never, 'ES256')
        const { payload: c1 } = await jwtVerify(p1, pub)
        const { payload: c2 } = await jwtVerify(p2, pub)
        expect(c1.ath).toBeUndefined()
        expect(c1.jti).not.toBe(c2.jti)
    })
})
