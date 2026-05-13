import { type EditorGroupNode, type WorkspaceState } from './types'

/** Current persisted schema version. Bump and add a migration when the shape
 *  of `WorkspaceState` changes. */
export const STORAGE_VERSION = 3

export type AnyPersisted = { version: number; state: unknown }

/** Per-version transformers. Each takes the previous-version state and returns
 *  the next-version state. Versions are applied sequentially from
 *  `persisted.version + 1` up to `STORAGE_VERSION`. */
const migrations: Record<number, (prev: unknown) => unknown> = {
    // v2 → v3: introduce `focusedLeafId`. Default to the first leaf in the
    // existing center tree so initial focus is sane on upgrade.
    3: (prev) => {
        const s = prev as Omit<WorkspaceState, 'focusedLeafId'>
        return { ...s, focusedLeafId: firstLeafId(s.center) }
    },
}

/** Run all migrations from the persisted version up to the current one. Returns
 *  null if the input is missing required fields after migration (caller treats
 *  this as "reset to initial"). */
export function runMigrations(persisted: AnyPersisted): WorkspaceState | null {
    let { version, state } = persisted
    if (version > STORAGE_VERSION) return null
    while (version < STORAGE_VERSION) {
        const next = version + 1
        const migrate = migrations[next]
        if (!migrate) return null
        state = migrate(state)
        version = next
    }
    return state as WorkspaceState
}

function firstLeafId(node: EditorGroupNode): string | null {
    if (node.kind === 'leaf') return node.id
    return firstLeafId(node.children[0]) ?? firstLeafId(node.children[1])
}
