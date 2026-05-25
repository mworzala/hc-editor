// React/web-only auth surfaces (gate component, launcher UI, the
// sessionStorage-backed active-project shim for web). Primitives that the
// model layer needs (dpop, keystore, sessionstore, redeem, tokens, types,
// idb, launch-code) live alongside `AuthService` in `../model/auth/`.

export { useAuth, type AuthContextValue } from '../model/auth/react'
export { AuthGate, OpenFromGame } from './gate'
export { Launcher } from './launcher'
export { createHashLaunchCodeSource } from '../model/auth/launch-code'
export { createWebCryptoKeyStore } from '../model/auth/keystore'
export { createIndexedDbSessionStore, createMemorySessionStore } from '../model/auth/sessionstore'
export { createTokenManager, type TokenManager, type TokenManagerDeps } from '../model/auth/tokens'
export { redeemLaunchCode, type RedeemDeps, type RedeemOutcome } from '../model/auth/redeem'
export { getActiveProjectId, setActiveProjectId } from './active-project'
export {
    buildClientKeyProof,
    buildDpopProof,
    jwkThumbprint,
    sha256Base64Url,
    type DpopProofInput,
} from '../model/auth/dpop'
export type {
    AccountMeta,
    AuthStatus,
    Session,
    SessionAuthState,
    SessionStore,
    StoredSession,
} from '../model/auth/types'
