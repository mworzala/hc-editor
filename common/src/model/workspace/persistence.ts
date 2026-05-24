// Persistence helpers for `WorkspaceLayoutService`.
//
// The schema-versioned migration + structural validation paths are
// re-used from `common/src/workspace/{migrations,validate}.ts` so stored
// layouts continue to load across schema changes. When the schema shape
// changes, bump `STORAGE_VERSION` and add a migration entry — don't
// redesign the persistence loop.
//
// The "fail to default" path is load-bearing: a parse throw, a missing
// intermediate migration, or a structurally invalid blob would otherwise
// be spread into the service and crash on first render; a reload re-reads
// the same poison → an unrecoverable crash loop. Drop the blob and let
// the service fall back to its initial state.

import type { Storage } from '../../platform'
import { STORAGE_VERSION } from '../../workspace/migrations'
import { runMigrations } from '../../workspace/migrations'
import { isWorkspaceState } from '../../workspace/validate'
import type { WorkspaceState } from '../../workspace/types'

type Persisted = { version: number; state: WorkspaceState }

export function readPersisted(storage: Storage, key: string): WorkspaceState | null {
    const raw = storage.get(key)
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as Persisted
        const migrated = runMigrations(parsed)
        if (migrated !== null && isWorkspaceState(migrated)) return migrated
    } catch {
        // A parse throw is treated the same as structurally invalid state —
        // fall through to the reset path below.
    }
    storage.remove(key)
    return null
}

export function writePersisted(storage: Storage, key: string, state: WorkspaceState): void {
    const payload: Persisted = { version: STORAGE_VERSION, state }
    storage.set(key, JSON.stringify(payload))
}

export { STORAGE_VERSION }
