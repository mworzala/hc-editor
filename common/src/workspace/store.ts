import { create, type StoreApi, type UseBoundStore } from 'zustand'

import { type Storage } from '@hollowcube/common/platform'

import { DEFAULT_SPLIT_BIAS } from './constants'
import { runMigrations, STORAGE_VERSION } from './migrations'
import {
    type ActiveDragState,
    type DockId,
    type EditorGroupNode,
    type Tab,
    type WorkspaceState,
} from './types'
import { isWorkspaceState } from './validate'

type Actions = {
    // Layout sizing
    setColumnSizes: (sizes: [number, number, number]) => void
    setMiddleSizes: (sizes: [number, number]) => void
    setLeafSplitSizes: (splitId: string, sizes: [number, number]) => void

    // Tab membership
    addTab: (location: TabLocation, tab: Tab) => void
    activateTab: (location: TabLocation, tabId: string) => void
    closeTab: (location: TabLocation, tabId: string) => void
    /** Patch a tab in place. Used when a host needs to change a tab's payload
     *  or title without churning its identity (e.g. saving an untitled file
     *  promotes its payload from `{ tempId }` to `{ path }`). */
    updateTab: (tabId: string, patch: Partial<Omit<Tab, 'id'>>) => void
    reorderTabs: (location: TabLocation, fromIdx: number, toIdx: number) => void
    moveTab: (from: TabLocation, to: TabLocation, tabId: string, targetIndex: number) => void
    /** Split a leaf into a new sibling, placing the tab on `side`. */
    splitLeafWithTab: (
        leafId: string,
        side: 'left' | 'right' | 'top' | 'bottom',
        from: TabLocation,
        tabId: string,
    ) => void

    // Dock visibility
    toggleDock: (dock: DockId) => void
    setDockVisible: (dock: DockId, visible: boolean) => void

    // Focus
    setFocusedLeaf: (leafId: string | null) => void

    // Transient drag state (lifted from React local state so debug overlays /
    // collaborative cursors can read it). Not persisted.
    setActiveDrag: (drag: ActiveDragState | null) => void
    setHoveredPaneId: (paneId: string | null) => void

    // Persistence helpers
    reset: () => void
}

export type TabLocation = { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string }

type Transient = {
    activeDrag: ActiveDragState | null
    hoveredPaneId: string | null
}

export type WorkspaceStore = WorkspaceState & Transient & Actions

type CreateOpts = {
    storageKey: string
    initialState: WorkspaceState
    storage: Storage
    /** Debounce window (ms) for writes back to storage. Defaults to 75ms. Set
     *  to 0 to write synchronously (useful for tests). */
    persistDebounceMs?: number
    /** Optional guard invoked before a `closeTab` runs. Return `false` (or a
     *  promise resolving to `false`) to veto the close — the store leaves the
     *  tab in place and the caller is responsible for issuing the close again
     *  once the guard's prerequisites are met. Used by the project shell to
     *  auto-save dirty editor tabs (and to prompt for a path on untitled tabs)
     *  before they're removed. */
    beforeCloseTab?: (tab: Tab, loc: TabLocation) => boolean | Promise<boolean>
}

type Persisted = { version: number; state: WorkspaceState }

function readPersisted(storage: Storage, key: string): WorkspaceState | null {
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
    // We get here when the blob failed to parse, `runMigrations` bailed
    // (missing intermediate migration or a version newer than this build),
    // or it parsed but is structurally wrong/partial. Returning it would
    // spread invalid state into the store and crash on first render; a reload
    // re-reads the same poison → an unrecoverable crash loop. Drop it so the
    // store falls back to `opts.initialState`. Losing layout is recoverable;
    // returning structurally-invalid state is not.
    storage.remove(key)
    return null
}

function writePersisted(storage: Storage, key: string, state: WorkspaceState) {
    const payload: Persisted = { version: STORAGE_VERSION, state }
    storage.set(key, JSON.stringify(payload))
}

/** Trailing-edge debouncer. The store's hot fields (resize sizes) tick on every
 *  pointermove during a drag; without this we serialize the entire workspace
 *  ~60 times per second. */
function debounced<Args extends unknown[]>(
    fn: (...args: Args) => void,
    wait: number,
): (...args: Args) => void {
    if (wait <= 0) return fn
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastArgs: Args | null = null
    return (...args: Args) => {
        lastArgs = args
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            timer = null
            if (lastArgs) fn(...lastArgs)
        }, wait)
    }
}

export function createWorkspaceStore(opts: CreateOpts): UseBoundStore<StoreApi<WorkspaceStore>> {
    const restored = readPersisted(opts.storage, opts.storageKey)
    const initial = restored ?? opts.initialState

    return create<WorkspaceStore>()((set, get) => {
        const debouncedWrite = debounced(
            (state: WorkspaceState) => writePersisted(opts.storage, opts.storageKey, state),
            opts.persistDebounceMs ?? 75,
        )

        const persist = () => {
            const s = get()
            debouncedWrite(snapshotPersistable(s))
        }

        return {
            ...initial,
            activeDrag: null,
            hoveredPaneId: null,

            setColumnSizes: (sizes) => {
                set({ columnSizes: sizes })
                persist()
            },
            setMiddleSizes: (sizes) => {
                set({ middleSizes: sizes })
                persist()
            },
            setLeafSplitSizes: (splitId, sizes) => {
                set((s) => ({ center: updateSplitSizes(s.center, splitId, sizes) }))
                persist()
            },

            addTab: (loc, tab) => {
                set((s) => {
                    const next = updateDockOrLeaf(s, loc, (d) => ({
                        ...d,
                        tabs: [...d.tabs, tab],
                        activeId: tab.id,
                    }))
                    if (loc.kind === 'editor') {
                        return { ...next, focusedLeafId: loc.leafId }
                    }
                    return next
                })
                persist()
            },

            activateTab: (loc, tabId) => {
                set((s) => {
                    const next = updateDockOrLeaf(s, loc, (d) => ({ ...d, activeId: tabId }))
                    if (loc.kind === 'editor') {
                        return { ...next, focusedLeafId: loc.leafId }
                    }
                    return next
                })
                persist()
            },

            closeTab: (loc, tabId) => {
                const guard = opts.beforeCloseTab
                const doClose = () => {
                    set((s) => {
                        const next = updateDockOrLeaf(s, loc, (d) => {
                            const tabs = d.tabs.filter((t) => t.id !== tabId)
                            const activeId =
                                d.activeId === tabId
                                    ? (tabs[
                                          Math.max(0, d.tabs.findIndex((t) => t.id === tabId) - 1)
                                      ]?.id ?? null)
                                    : d.activeId
                            return { ...d, tabs, activeId }
                        })
                        if (loc.kind !== 'editor') return next
                        const pruned = pruneEmptyLeaves(next)
                        return rebindFocusIfMissing(pruned)
                    })
                    persist()
                }
                if (!guard) {
                    doClose()
                    return
                }
                // Look up the tab snapshot before close so the guard can read
                // its kind / payload.
                const tab = findTabInState(get(), tabId)
                if (!tab) {
                    doClose()
                    return
                }
                const result = guard(tab, loc)
                if (typeof result === 'boolean') {
                    if (result) doClose()
                    return
                }
                void result.then((ok) => {
                    if (ok) doClose()
                    return undefined
                })
            },

            updateTab: (tabId, patch) => {
                set((s) => patchTabEverywhere(s, tabId, patch))
                persist()
            },

            reorderTabs: (loc, fromIdx, toIdx) => {
                set((s) =>
                    updateDockOrLeaf(s, loc, (d) => {
                        const tabs = d.tabs.slice()
                        const [moved] = tabs.splice(fromIdx, 1)
                        if (moved) tabs.splice(toIdx, 0, moved)
                        return { ...d, tabs }
                    }),
                )
                persist()
            },

            moveTab: (from, to, tabId, targetIndex) => {
                set((s) => {
                    let movedTab: Tab | null = null
                    const removed = updateDockOrLeaf(s, from, (d) => {
                        const idx = d.tabs.findIndex((t) => t.id === tabId)
                        if (idx === -1) return d
                        movedTab = d.tabs[idx] ?? null
                        const tabs = d.tabs.toSpliced(idx, 1)
                        const activeId =
                            d.activeId === tabId
                                ? (tabs[Math.max(0, idx - 1)]?.id ?? null)
                                : d.activeId
                        return { ...d, tabs, activeId }
                    })
                    if (!movedTab) return s

                    const inserted = updateDockOrLeaf(removed, to, (d) => {
                        const tabs = d.tabs.slice()
                        const idx = Math.max(0, Math.min(targetIndex, tabs.length))
                        tabs.splice(idx, 0, movedTab!)
                        return { ...d, tabs, activeId: movedTab!.id }
                    })

                    const finalState =
                        to.kind === 'editor' ? { ...inserted, focusedLeafId: to.leafId } : inserted
                    return from.kind === 'editor' || to.kind === 'editor'
                        ? rebindFocusIfMissing(pruneEmptyLeaves(finalState))
                        : finalState
                })
                persist()
            },

            splitLeafWithTab: (leafId, side, from, tabId) => {
                set((s) => {
                    let movedTab: Tab | null = null
                    let next = updateDockOrLeaf(s, from, (d) => {
                        const idx = d.tabs.findIndex((t) => t.id === tabId)
                        if (idx === -1) return d
                        movedTab = d.tabs[idx] ?? null
                        const tabs = d.tabs.toSpliced(idx, 1)
                        const activeId =
                            d.activeId === tabId
                                ? (tabs[Math.max(0, idx - 1)]?.id ?? null)
                                : d.activeId
                        return { ...d, tabs, activeId }
                    })
                    if (!movedTab) return s

                    let newLeafId: string | null = null
                    next = {
                        ...next,
                        center: splitLeafInTree(next.center, leafId, side, movedTab, (id) => {
                            newLeafId = id
                        }),
                    }
                    const pruned = rebindFocusIfMissing(pruneEmptyLeaves(next))
                    return newLeafId ? { ...pruned, focusedLeafId: newLeafId } : pruned
                })
                persist()
            },

            toggleDock: (dock) => {
                set((s) => ({
                    docksVisible: { ...s.docksVisible, [dock]: !s.docksVisible[dock] },
                }))
                persist()
            },
            setDockVisible: (dock, visible) => {
                set((s) => ({ docksVisible: { ...s.docksVisible, [dock]: visible } }))
                persist()
            },

            setFocusedLeaf: (leafId) => {
                set({ focusedLeafId: leafId })
                persist()
            },

            setActiveDrag: (drag) => set({ activeDrag: drag }),
            setHoveredPaneId: (paneId) => set({ hoveredPaneId: paneId }),

            reset: () => {
                opts.storage.remove(opts.storageKey)
                set({ ...opts.initialState, activeDrag: null, hoveredPaneId: null })
            },
        }
    })
}

/** Strip transient and action fields so the persisted blob holds only
 *  `WorkspaceState`. */
function snapshotPersistable(s: WorkspaceStore): WorkspaceState {
    return {
        columnSizes: s.columnSizes,
        middleSizes: s.middleSizes,
        docksVisible: s.docksVisible,
        left: s.left,
        right: s.right,
        bottom: s.bottom,
        center: s.center,
        focusedLeafId: s.focusedLeafId,
    }
}

export function clearWorkspaceStorage(storage: Storage, key: string) {
    storage.remove(key)
}

// ---------- selectors ----------

/** Build a `tabId → location` map so drag handlers don't re-walk the tree on
 *  every onDragOver tick. Callers should memoize on the relevant slices
 *  (left/right/bottom tabs and the center tree). */
export function selectTabLocations(state: WorkspaceState): Map<string, TabLocation> {
    const map = new Map<string, TabLocation>()
    for (const dock of ['left', 'right', 'bottom'] as const) {
        for (const tab of state[dock].tabs) {
            map.set(tab.id, { kind: 'tool', dock })
        }
    }
    walkLeaves(state.center, (leaf) => {
        for (const tab of leaf.tabs) {
            map.set(tab.id, { kind: 'editor', leafId: leaf.id })
        }
    })
    return map
}

function walkLeaves(
    node: EditorGroupNode,
    visit: (leaf: Extract<EditorGroupNode, { kind: 'leaf' }>) => void,
): void {
    if (node.kind === 'leaf') {
        visit(node)
        return
    }
    walkLeaves(node.children[0], visit)
    walkLeaves(node.children[1], visit)
}

export function findLeaf(
    node: EditorGroupNode,
    leafId: string,
): Extract<EditorGroupNode, { kind: 'leaf' }> | null {
    if (node.kind === 'leaf') return node.id === leafId ? node : null
    return findLeaf(node.children[0], leafId) ?? findLeaf(node.children[1], leafId)
}

/** Walk the tree and return the first leaf node. */
export function findFirstLeaf(node: EditorGroupNode): Extract<EditorGroupNode, { kind: 'leaf' }> {
    if (node.kind === 'leaf') return node
    return findFirstLeaf(node.children[0])
}

/** Return the focused leaf if it still exists, else the first leaf in the tree. */
export function resolveTargetLeaf(
    state: WorkspaceState,
): Extract<EditorGroupNode, { kind: 'leaf' }> {
    if (state.focusedLeafId) {
        const leaf = findLeaf(state.center, state.focusedLeafId)
        if (leaf) return leaf
    }
    return findFirstLeaf(state.center)
}

/** Active "context tags" derived from workspace state, consumed by the action
 *  registry to scope availability:
 *
 *   • `'global'` — always present.
 *   • `'tool:<kind>'` — added for every tool whose tab is mounted in any dock.
 *      Being mounted is enough; the dock doesn't need to be visible. We add
 *      one tag per *distinct* tool kind across all three docks.
 *   • `'editor:<kind>'` — kind of the active tab in the focused leaf. Single
 *      value; only present when an editor is actually focused.
 *
 *  A tab is treated as a tool iff `kind` starts with `'tool:'`. */
export function selectActiveContextTags(state: WorkspaceState): Set<string> {
    const tags = new Set<string>()
    tags.add('global')

    for (const dock of ['left', 'right', 'bottom'] as const) {
        for (const tab of state[dock].tabs) {
            if (tab.kind.startsWith('tool:')) tags.add(tab.kind)
        }
    }

    if (state.focusedLeafId) {
        const leaf = findLeaf(state.center, state.focusedLeafId)
        if (leaf && leaf.activeId) {
            const active = leaf.tabs.find((t) => t.id === leaf.activeId)
            if (active && !active.kind.startsWith('tool:')) {
                tags.add(active.kind)
            }
        }
    }

    return tags
}

// ---------- pure tree helpers ----------

function updateDockOrLeaf(
    state: WorkspaceState,
    loc: TabLocation,
    update: <T extends { tabs: Tab[]; activeId: string | null }>(d: T) => T,
): WorkspaceState {
    if (loc.kind === 'tool') {
        return { ...state, [loc.dock]: update(state[loc.dock]) } as WorkspaceState
    }
    return { ...state, center: mapLeaf(state.center, loc.leafId, update) }
}

function mapLeaf(
    node: EditorGroupNode,
    leafId: string,
    update: (
        leaf: Extract<EditorGroupNode, { kind: 'leaf' }>,
    ) => Extract<EditorGroupNode, { kind: 'leaf' }>,
): EditorGroupNode {
    if (node.kind === 'leaf') {
        if (node.id !== leafId) return node
        return update(node)
    }
    return {
        ...node,
        children: [
            mapLeaf(node.children[0], leafId, update),
            mapLeaf(node.children[1], leafId, update),
        ],
    }
}

function updateSplitSizes(
    node: EditorGroupNode,
    splitId: string,
    sizes: [number, number],
): EditorGroupNode {
    if (node.kind === 'leaf') return node
    if (node.id === splitId) return { ...node, sizes }
    return {
        ...node,
        children: [
            updateSplitSizes(node.children[0], splitId, sizes),
            updateSplitSizes(node.children[1], splitId, sizes),
        ],
    }
}

function splitLeafInTree(
    node: EditorGroupNode,
    leafId: string,
    side: 'left' | 'right' | 'top' | 'bottom',
    tab: Tab,
    onNewLeaf: (leafId: string) => void,
): EditorGroupNode {
    if (node.kind === 'split') {
        return {
            ...node,
            children: [
                splitLeafInTree(node.children[0], leafId, side, tab, onNewLeaf),
                splitLeafInTree(node.children[1], leafId, side, tab, onNewLeaf),
            ],
        }
    }
    if (node.id !== leafId) return node

    const newLeafId = makeId('leaf')
    onNewLeaf(newLeafId)
    const newLeaf: EditorGroupNode = {
        kind: 'leaf',
        id: newLeafId,
        tabs: [tab],
        activeId: tab.id,
    }

    const orientation = side === 'left' || side === 'right' ? 'horizontal' : 'vertical'
    const before = side === 'left' || side === 'top'

    return {
        kind: 'split',
        id: makeId('split'),
        orientation,
        sizes: [DEFAULT_SPLIT_BIAS[0], DEFAULT_SPLIT_BIAS[1]],
        children: before ? [newLeaf, node] : [node, newLeaf],
    }
}

/** Collapse any empty `leaf` nodes by replacing their parent split with the
 *  remaining sibling. Keeps at least one leaf at the root. */
function pruneEmptyLeaves(state: WorkspaceState): WorkspaceState {
    const next = walkPrune(state.center)
    return { ...state, center: next ?? makeEmptyLeaf() }
}

function walkPrune(node: EditorGroupNode): EditorGroupNode | null {
    if (node.kind === 'leaf') return node.tabs.length > 0 ? node : null
    const left = walkPrune(node.children[0])
    const right = walkPrune(node.children[1])
    if (left && right) return { ...node, children: [left, right] }
    return left ?? right ?? null
}

function makeEmptyLeaf(): EditorGroupNode {
    return { kind: 'leaf', id: makeId('leaf'), tabs: [], activeId: null }
}

/** If `focusedLeafId` no longer points at a real leaf (because it was pruned),
 *  fall back to the first leaf in the tree. */
function rebindFocusIfMissing(state: WorkspaceState): WorkspaceState {
    if (state.focusedLeafId && findLeaf(state.center, state.focusedLeafId)) return state
    return { ...state, focusedLeafId: findFirstLeaf(state.center).id }
}

export function makeId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`
}

function findTabInState(state: WorkspaceState, tabId: string): Tab | null {
    for (const dock of ['left', 'right', 'bottom'] as const) {
        const hit = state[dock].tabs.find((t) => t.id === tabId)
        if (hit) return hit
    }
    let found: Tab | null = null
    walkLeaves(state.center, (leaf) => {
        if (found) return
        const hit = leaf.tabs.find((t) => t.id === tabId)
        if (hit) found = hit
    })
    return found
}

function patchTabEverywhere(
    state: WorkspaceState,
    tabId: string,
    patch: Partial<Omit<Tab, 'id'>>,
): WorkspaceState {
    const patchTabs = (tabs: Tab[]): Tab[] => {
        let touched = false
        const next = tabs.map((t) => {
            if (t.id !== tabId) return t
            touched = true
            return { ...t, ...patch, id: t.id }
        })
        return touched ? next : tabs
    }
    const next: WorkspaceState = {
        ...state,
        left: { ...state.left, tabs: patchTabs(state.left.tabs) },
        right: { ...state.right, tabs: patchTabs(state.right.tabs) },
        bottom: { ...state.bottom, tabs: patchTabs(state.bottom.tabs) },
        center: mapAllLeaves(state.center, (leaf) => ({
            ...leaf,
            tabs: patchTabs(leaf.tabs),
        })),
    }
    return next
}

function mapAllLeaves(
    node: EditorGroupNode,
    update: (
        leaf: Extract<EditorGroupNode, { kind: 'leaf' }>,
    ) => Extract<EditorGroupNode, { kind: 'leaf' }>,
): EditorGroupNode {
    if (node.kind === 'leaf') return update(node)
    return {
        ...node,
        children: [mapAllLeaves(node.children[0], update), mapAllLeaves(node.children[1], update)],
    }
}
