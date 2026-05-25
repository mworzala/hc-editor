// Auth domain types. Wire-format Zod schemas live in the api endpoint files
// (same convention as MapEditorBootstrapSchema in v1-map-editor-bootstrap.ts)
// so the api package
// owns the contract and `common` depends on `api`, never the reverse.

import type { AccountMeta } from '@hollowcube/api'

export type { AccountMeta }

// Persisted, non-secret session record. Access tokens are NEVER persisted —
// they live only in the in-memory token manager.
export interface StoredSession {
    /** Stable account id — the primary key (== AccountMeta.id). */
    account: string
    sessionId: string
    accountMeta: AccountMeta
}

export type SessionAuthState = 'active' | 'needs-reauth'

/** A stored session plus its derived runtime auth state. */
export interface Session extends StoredSession {
    state: SessionAuthState
}

/** Persistence of the account → session map. Behind an interface so the
 *  token/session logic is unit-testable with an in-memory fake (bun has no
 *  IndexedDB); the IndexedDB impl is the only manually-verified surface. */
export interface SessionStore {
    list(): Promise<StoredSession[]>
    get(account: string): Promise<StoredSession | null>
    save(session: StoredSession): Promise<void>
    remove(account: string): Promise<void>
    clear(): Promise<void>
}

export type AuthStatus =
    | { kind: 'initializing' }
    | { kind: 'redeeming' }
    | { kind: 'picking' } // sessions exist, none active yet → launcher
    | { kind: 'authenticated'; account: string }
    | { kind: 'unauthenticated' } // no sessions, no launch code
    | { kind: 'error'; error: unknown }
