import { exportJWK } from 'jose'

import { jwkThumbprint } from './dpop'
import { idbGet, idbPut, KEY_STORE } from './idb'

/** Persistent client keypair store. Today both platforms use
 *  `createWebCryptoKeyStore` — a WebCrypto keypair persisted as a
 *  structured-cloneable CryptoKey handle in IndexedDB, with a
 *  non-extractable private key. The interface is kept so a future desktop
 *  build can back this with the OS keychain / Secure Enclave without
 *  changing the auth module. */
export type ClientKeyStore = {
    /** Return the persistent client keypair, generating + persisting one on
     *  first use. The private key is non-extractable. */
    getOrCreate(): Promise<CryptoKeyPair>
    /** Public key as a JWK with no private fields — sent as
     *  `client_public_key` on first redeem and embedded in every DPoP proof
     *  header. */
    exportPublicJwk(): Promise<JsonWebKey>
    /** RFC 7638 SHA-256 JWK thumbprint, base64url no padding. Equals the
     *  backend `client.key_id`. */
    thumbprint(): Promise<string>
}

const KEY_ID = 'client'
// FLAG(backend): ES256 → ECDSA P-256. Non-extractable private key. WebCrypto
// always keeps the public key extractable regardless of this flag.
const ALGO: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' }

export function createWebCryptoKeyStore(): ClientKeyStore {
    let pairPromise: Promise<CryptoKeyPair> | null = null

    const getOrCreate = (): Promise<CryptoKeyPair> =>
        (pairPromise ??= (async () => {
            const existing = await idbGet<CryptoKeyPair>(KEY_STORE, KEY_ID)
            if (existing) return existing
            const pair = await crypto.subtle.generateKey(ALGO, false, ['sign', 'verify'])
            await idbPut(KEY_STORE, KEY_ID, pair)
            return pair
        })())

    const exportPublicJwk = async (): Promise<JsonWebKey> => {
        const { publicKey } = await getOrCreate()
        return (await exportJWK(publicKey)) as JsonWebKey
    }

    return {
        getOrCreate,
        exportPublicJwk,
        thumbprint: async () => jwkThumbprint(await exportPublicJwk()),
    }
}
