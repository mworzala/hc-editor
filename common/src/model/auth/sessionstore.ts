import { idbClear, idbDelete, idbGet, idbGetAll, idbPut, SESSION_STORE } from './idb'
import type { SessionStore, StoredSession } from './types'

// IndexedDB-backed account → session map. Only non-secret metadata is stored
// (account id, session id, display info). Access tokens never touch this.
export function createIndexedDbSessionStore(): SessionStore {
    return {
        list: () => idbGetAll<StoredSession>(SESSION_STORE),
        get: async (account) => (await idbGet<StoredSession>(SESSION_STORE, account)) ?? null,
        save: (session) => idbPut(SESSION_STORE, session.account, session),
        remove: (account) => idbDelete(SESSION_STORE, account),
        clear: () => idbClear(SESSION_STORE),
    }
}

// In-memory impl — the unit-test fake and a safe fallback when IndexedDB is
// unavailable (private browsing, SSR).
export function createMemorySessionStore(): SessionStore {
    const map = new Map<string, StoredSession>()
    return {
        list: () => Promise.resolve([...map.values()]),
        get: (account) => Promise.resolve(map.get(account) ?? null),
        save: (session) => {
            map.set(session.account, session)
            return Promise.resolve()
        },
        remove: (account) => {
            map.delete(account)
            return Promise.resolve()
        },
        clear: () => {
            map.clear()
            return Promise.resolve()
        },
    }
}
