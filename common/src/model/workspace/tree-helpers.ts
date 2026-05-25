// Pure tree / state helpers shared by `WorkspaceLayoutService` and a few
// React consumers (drag handlers, action handlers). Copied verbatim from
// the old Zustand store so behavior is byte-for-byte preserved.

import { DEFAULT_SPLIT_BIAS } from '../../workspace/constants'
import type { DockId, EditorGroupNode, Tab, WorkspaceState } from '../../workspace/types'

export type TabLocation = { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string }

export function makeId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`
}

export function findLeaf(
    node: EditorGroupNode,
    leafId: string,
): Extract<EditorGroupNode, { kind: 'leaf' }> | null {
    if (node.kind === 'leaf') return node.id === leafId ? node : null
    return findLeaf(node.children[0], leafId) ?? findLeaf(node.children[1], leafId)
}

export function findFirstLeaf(node: EditorGroupNode): Extract<EditorGroupNode, { kind: 'leaf' }> {
    if (node.kind === 'leaf') return node
    return findFirstLeaf(node.children[0])
}

export function resolveTargetLeaf(
    state: WorkspaceState,
): Extract<EditorGroupNode, { kind: 'leaf' }> {
    if (state.focusedLeafId) {
        const leaf = findLeaf(state.center, state.focusedLeafId)
        if (leaf) return leaf
    }
    return findFirstLeaf(state.center)
}

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

// ---------- mutation helpers ----------

export function updateDockOrLeaf(
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

export function updateSplitSizes(
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

export function splitLeafInTree(
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

export function pruneEmptyLeaves(state: WorkspaceState): WorkspaceState {
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

export function rebindFocusIfMissing(state: WorkspaceState): WorkspaceState {
    if (state.focusedLeafId && findLeaf(state.center, state.focusedLeafId)) return state
    return { ...state, focusedLeafId: findFirstLeaf(state.center).id }
}

export function patchTabEverywhere(
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
    return {
        ...state,
        left: { ...state.left, tabs: patchTabs(state.left.tabs) },
        right: { ...state.right, tabs: patchTabs(state.right.tabs) },
        bottom: { ...state.bottom, tabs: patchTabs(state.bottom.tabs) },
        center: mapAllLeaves(state.center, (leaf) => ({
            ...leaf,
            tabs: patchTabs(leaf.tabs),
        })),
    }
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
