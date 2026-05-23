import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'

import { useLayoutState } from '../../model/workspace'
import { selectActiveContextTags } from '../../workspace'
import { type WorkspaceState } from '../../workspace/types'
import { type ActionContextSet } from './types'

// Publishes the active context-tag set derived from workspace state.
//
// Two ways to read it:
//
//   • `useActionContextSet()` — reactive; re-renders consumers on change. Use
//     in the search popup and other React UI that needs to filter as state
//     changes.
//   • `getActionContextSnapshot()` — non-reactive; reads the latest set from a
//     ref. Used by the hotkey bridge so it doesn't rebind hotkeys on every
//     focus flip.
//
// Both share one source of truth: the ref maintained by the provider.

type Snapshot = () => ActionContextSet

type ContextValue = {
    tags: ActionContextSet
    getSnapshot: Snapshot
}

const EMPTY: ActionContextSet = new Set(['global'])

const ActionContextContext = createContext<ContextValue | null>(null)

export function ActionContextProvider({ children }: { children: ReactNode }) {
    // Subscribe to layout state via the signal hook. Re-derive the tag
    // set only when the fingerprint (which captures every input to
    // `selectActiveContextTags`) changes.
    const state = useLayoutState()
    const fingerprint = useMemo(() => contextFingerprint(state), [state])
    const tags = useMemo<ActionContextSet>(
        () => selectActiveContextTags(state),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint already encodes everything we care about
        [fingerprint],
    )

    // Mirror the latest set into a ref so non-reactive callers (hotkey bridge)
    // can read it synchronously without subscribing.
    const ref = useRef<ActionContextSet>(tags)
    useEffect(() => {
        ref.current = tags
    }, [tags])

    const value = useMemo<ContextValue>(() => ({ tags, getSnapshot: () => ref.current }), [tags])

    return <ActionContextContext.Provider value={value}>{children}</ActionContextContext.Provider>
}

// Encodes every input to `selectActiveContextTags` as a stable string. Changes
// iff the resulting tag set might change. Cheap to compute on every store
// notification.
function contextFingerprint(state: WorkspaceState): string {
    const toolKinds: string[] = []
    for (const dock of ['left', 'right', 'bottom'] as const) {
        for (const tab of state[dock].tabs) {
            if (tab.kind.startsWith('tool:')) toolKinds.push(tab.kind)
        }
    }
    toolKinds.sort()
    const focusedKind = focusedEditorKind(state)
    return `${toolKinds.join('|')}#${focusedKind ?? ''}`
}

function focusedEditorKind(state: WorkspaceState): string | null {
    if (!state.focusedLeafId) return null
    const leaf = findLeafFromState(state)
    if (!leaf || !leaf.activeId) return null
    const active = leaf.tabs.find((t) => t.id === leaf.activeId)
    if (!active || active.kind.startsWith('tool:')) return null
    return active.kind
}

function findLeafFromState(state: WorkspaceState) {
    // Inline find rather than re-importing the helper to keep this file
    // depending only on types.
    type Leaf = {
        kind: 'leaf'
        id: string
        tabs: { id: string; kind: string }[]
        activeId: string | null
    }
    const target = state.focusedLeafId
    if (!target) return null
    const stack = [state.center]
    while (stack.length > 0) {
        const node = stack.pop()!
        if (node.kind === 'leaf') {
            if (node.id === target) return node as unknown as Leaf
        } else {
            stack.push(node.children[0], node.children[1])
        }
    }
    return null
}

/** Reactive read of the active tag set. */
export function useActionContextSet(): ActionContextSet {
    const ctx = useContext(ActionContextContext)
    return ctx?.tags ?? EMPTY
}

/** Returns a function that reads the latest active tag set without
 *  subscribing the calling component to re-renders. Safe to call once at
 *  mount; the returned function reads through to the current set every time. */
export function useActionContextSnapshot(): Snapshot {
    const ctx = useContext(ActionContextContext)
    if (!ctx) return () => EMPTY
    return ctx.getSnapshot
}

/** Returns true if `tags` is a subset of `active`. Empty / missing `tags`
 *  means "global" and always matches. */
export function actionMatchesContext(
    active: ActionContextSet,
    tags: readonly string[] | undefined,
): boolean {
    if (!tags || tags.length === 0) return true
    for (const tag of tags) {
        if (!active.has(tag)) return false
    }
    return true
}
