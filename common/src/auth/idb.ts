// Internal IndexedDB glue shared by the keystore + sessionstore. Not part of
// the module's public surface (not re-exported from index.ts). One DB, one
// version, two object stores so the schemas can't diverge.
//
// CryptoKey handles are structured-cloneable, so the keypair is stored here
// directly — never exported, never serialized, never in localStorage.

const DB_NAME = 'hc-auth'
const DB_VERSION = 1
export const KEY_STORE = 'keys'
export const SESSION_STORE = 'sessions'

let dbPromise: Promise<IDBDatabase> | null = null

export function openAuthDb(): Promise<IDBDatabase> {
    return (dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.addEventListener('upgradeneeded', () => {
            const db = req.result
            if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
            if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE)
        })
        req.addEventListener('success', () => resolve(req.result))
        req.addEventListener('error', () => reject(req.error))
    }))
}

function tx<T>(
    store: string,
    mode: IDBTransactionMode,
    run: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
    return openAuthDb().then(
        (db) =>
            new Promise<T>((resolve, reject) => {
                const request = run(db.transaction(store, mode).objectStore(store))
                request.addEventListener('success', () => resolve(request.result as T))
                request.addEventListener('error', () => reject(request.error))
            }),
    )
}

export const idbGet = <T>(store: string, key: IDBValidKey): Promise<T | undefined> =>
    tx<T | undefined>(store, 'readonly', (s) => s.get(key))

export const idbGetAll = <T>(store: string): Promise<T[]> =>
    tx<T[]>(store, 'readonly', (s) => s.getAll())

export const idbPut = (store: string, key: IDBValidKey, value: unknown): Promise<void> =>
    tx<void>(store, 'readwrite', (s) => s.put(value, key))

export const idbDelete = (store: string, key: IDBValidKey): Promise<void> =>
    tx<void>(store, 'readwrite', (s) => s.delete(key))

export const idbClear = (store: string): Promise<void> =>
    tx<void>(store, 'readwrite', (s) => s.clear())
