// Model-layer auth surface: the orchestration service plus the primitive
// pieces it composes (DPoP signing, token refresh, session storage,
// launch-code redemption, key storage). React-coupled views (gate,
// launcher) live in `common/src/auth/`.

export { AuthService, type AuthServiceDeps } from './AuthService'
export { useAuth, type AuthContextValue } from './react'
export {
    buildClientKeyProof,
    buildDpopProof,
    jwkThumbprint,
    sha256Base64Url,
    type DpopProofInput,
} from './dpop'
export { createWebCryptoKeyStore, type ClientKeyStore } from './keystore'
export { createHashLaunchCodeSource } from './launch-code'
export { redeemLaunchCode, type RedeemDeps, type RedeemOutcome } from './redeem'
export { createIndexedDbSessionStore, createMemorySessionStore } from './sessionstore'
export { createTokenManager, type TokenManager, type TokenManagerDeps } from './tokens'
export type { AuthStatus, Session, SessionAuthState, SessionStore, StoredSession } from './types'
export { IndexedDbUnavailableError } from './idb'
