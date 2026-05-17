import { exportJWK } from 'jose'

import type { ClientKeyStore } from '../platform'
import { jwkThumbprint } from './dpop'
import { idbGet, idbPut, KEY_STORE } from './idb'

// Phase 1 default ClientKeyStore (both platforms): WebCrypto keypair persisted
// as structured-cloneable CryptoKey handles in IndexedDB. The private key is
// non-extractable, so it can never leave the browser/webview. Phase 2 desktop
// swaps this out via the Platform.keyStore seam (OS keychain).

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
