import { beforeEach, describe, expect, test } from 'bun:test'

import { createMemoryStorage, type Storage } from '../platform'
import { createWorkspaceStore, findLeaf, selectActiveContextTags } from './store'
import { type EditorGroupNode, type Tab, type WorkspaceState } from './types'

const STORAGE_KEY = 'test:workspace'

function leaf(id: string, tabs: Tab[] = [], activeId: string | null = null): EditorGroupNode {
    return { kind: 'leaf', id, tabs, activeId }
}

function makeInitial(centerLeafId = 'leaf-center'): WorkspaceState {
    return {
        columnSizes: [22, 78, 0],
        middleSizes: [100, 0],
        docksVisible: { left: true, right: false, bottom: false },
        left: { tabs: [], activeId: null },
        right: { tabs: [], activeId: null },
        bottom: { tabs: [], activeId: null },
        center: leaf(centerLeafId),
        focusedLeafId: centerLeafId,
    }
}

function makeStore(opts?: {
    initialState?: WorkspaceState
    storage?: Storage
    beforeCloseTab?: Parameters<typeof createWorkspaceStore>[0]['beforeCloseTab']
}) {
    const storage = opts?.storage ?? createMemoryStorage()
    return createWorkspaceStore({
        storageKey: STORAGE_KEY,
        initialState: opts?.initialState ?? makeInitial(),
        storage,
        persistDebounceMs: 0, // write synchronously in tests
        beforeCloseTab: opts?.beforeCloseTab,
    })
}

const tab = (id: string, kind = 'editor:text', title = id): Tab => ({ id, kind, title })

describe('workspace store — addTab', () => {
    test('adds a tab to a tool dock and activates it', () => {
        const store = makeStore()
        store.getState().addTab({ kind: 'tool', dock: 'left' }, tab('t1', 'tool:files', 'Files'))

        const { left } = store.getState()
        expect(left.tabs).toHaveLength(1)
        expect(left.tabs[0]!.id).toBe('t1')
        expect(left.activeId).toBe('t1')
    })

    test('adds a tab to an editor leaf and moves focus there', () => {
        const initial = makeInitial('leaf-A')
        initial.center = {
            kind: 'split',
            id: 'split-1',
            orientation: 'horizontal',
            sizes: [50, 50],
            children: [leaf('leaf-A'), leaf('leaf-B')],
        }
        initial.focusedLeafId = 'leaf-A'

        const store = makeStore({ initialState: initial })
        store.getState().addTab({ kind: 'editor', leafId: 'leaf-B' }, tab('t1'))

        expect(store.getState().focusedLeafId).toBe('leaf-B')
        const leafB = findLeaf(store.getState().center, 'leaf-B')!
        expect(leafB.tabs).toHaveLength(1)
        expect(leafB.activeId).toBe('t1')
    })

    test('adding to a tool dock does not move editor focus', () => {
        const store = makeStore()
        const before = store.getState().focusedLeafId
        store.getState().addTab({ kind: 'tool', dock: 'left' }, tab('t1', 'tool:files'))
        expect(store.getState().focusedLeafId).toBe(before)
    })
})

describe('workspace store — closeTab', () => {
    test('removes the tab and falls back to the previous tab as active', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2'), tab('t3')], 't2')
        const store = makeStore({ initialState: initial })

        store.getState().closeTab({ kind: 'editor', leafId: 'leaf-A' }, 't2')

        const leafA = findLeaf(store.getState().center, 'leaf-A')!
        expect(leafA.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
        // active was the second tab; closing it falls back to the prior one (t1).
        expect(leafA.activeId).toBe('t1')
    })

    test('preserves activeId if a non-active tab is closed', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't2')
        const store = makeStore({ initialState: initial })

        store.getState().closeTab({ kind: 'editor', leafId: 'leaf-A' }, 't1')

        const leafA = findLeaf(store.getState().center, 'leaf-A')!
        expect(leafA.activeId).toBe('t2')
    })

    test('vetoes close when sync beforeCloseTab returns false', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1')], 't1')
        const store = makeStore({
            initialState: initial,
            beforeCloseTab: () => false,
        })

        store.getState().closeTab({ kind: 'editor', leafId: 'leaf-A' }, 't1')

        const leafA = findLeaf(store.getState().center, 'leaf-A')!
        expect(leafA.tabs).toHaveLength(1) // veto held
    })

    test('proceeds when async beforeCloseTab resolves true', async () => {
        const initial = makeInitial('leaf-A')
        // Two tabs so the leaf survives the close (single-tab leaves get pruned).
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't1')
        const store = makeStore({
            initialState: initial,
            beforeCloseTab: () => Promise.resolve(true),
        })

        store.getState().closeTab({ kind: 'editor', leafId: 'leaf-A' }, 't1')

        // Wait a microtask for the resolved promise to flush.
        await Promise.resolve()
        await Promise.resolve()

        const leafA = findLeaf(store.getState().center, 'leaf-A')!
        expect(leafA.tabs.map((t) => t.id)).toEqual(['t2'])
    })
})

describe('workspace store — moveTab', () => {
    test('moves a tab from one leaf to another and updates focus', () => {
        const initial = makeInitial('leaf-A')
        initial.center = {
            kind: 'split',
            id: 'split-1',
            orientation: 'horizontal',
            sizes: [50, 50],
            children: [leaf('leaf-A', [tab('t1')], 't1'), leaf('leaf-B', [tab('t2')], 't2')],
        }
        initial.focusedLeafId = 'leaf-A'
        const store = makeStore({ initialState: initial })

        store
            .getState()
            .moveTab(
                { kind: 'editor', leafId: 'leaf-A' },
                { kind: 'editor', leafId: 'leaf-B' },
                't1',
                1,
            )

        const leafB = findLeaf(store.getState().center, 'leaf-B')!
        expect(leafB.tabs.map((t) => t.id)).toEqual(['t2', 't1'])
        expect(leafB.activeId).toBe('t1')
        expect(store.getState().focusedLeafId).toBe('leaf-B')

        // Source leaf is empty and gets pruned; the split collapses to a single
        // leaf. `findLeaf(leaf-A)` should now return null.
        expect(findLeaf(store.getState().center, 'leaf-A')).toBeNull()
    })

    test('is a no-op when the source does not contain the tab', () => {
        const store = makeStore()
        const before = store.getState().center
        store
            .getState()
            .moveTab(
                { kind: 'editor', leafId: 'leaf-center' },
                { kind: 'editor', leafId: 'leaf-center' },
                'nope',
                0,
            )
        expect(store.getState().center).toBe(before)
    })
})

describe('workspace store — splitLeafWithTab', () => {
    test('moves the tab into a freshly split sibling leaf', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't2')
        const store = makeStore({ initialState: initial })

        store
            .getState()
            .splitLeafWithTab('leaf-A', 'right', { kind: 'editor', leafId: 'leaf-A' }, 't2')

        const root = store.getState().center
        expect(root.kind).toBe('split')
        if (root.kind !== 'split') throw new Error('unreachable')
        expect(root.orientation).toBe('horizontal')

        const [left, right] = root.children
        expect(left.kind).toBe('leaf')
        expect(right.kind).toBe('leaf')
        if (left.kind !== 'leaf' || right.kind !== 'leaf') throw new Error('unreachable')
        expect(left.tabs.map((t) => t.id)).toEqual(['t1'])
        expect(right.tabs.map((t) => t.id)).toEqual(['t2'])

        // Focus follows the new leaf.
        expect(store.getState().focusedLeafId).toBe(right.id)
    })

    test('side=top creates a vertical split with the new leaf above', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't1')
        const store = makeStore({ initialState: initial })

        store
            .getState()
            .splitLeafWithTab('leaf-A', 'top', { kind: 'editor', leafId: 'leaf-A' }, 't2')

        const root = store.getState().center
        if (root.kind !== 'split') throw new Error('expected split')
        expect(root.orientation).toBe('vertical')

        const [top] = root.children
        if (top.kind !== 'leaf') throw new Error('expected leaf')
        expect(top.tabs.map((t) => t.id)).toEqual(['t2'])
    })
})

describe('workspace store — updateTab', () => {
    test('patches title and payload across every dock/leaf where the id appears', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1', 'editor:text', 'Old')], 't1')
        const store = makeStore({ initialState: initial })

        store.getState().updateTab('t1', { title: 'New', payload: { path: 'src/foo.luau' } })

        const leafA = findLeaf(store.getState().center, 'leaf-A')!
        expect(leafA.tabs[0]!.title).toBe('New')
        expect(leafA.tabs[0]!.payload).toEqual({ path: 'src/foo.luau' })
    })
})

describe('workspace store — focus tracking', () => {
    test('activateTab in an editor leaf updates focusedLeafId', () => {
        const initial = makeInitial('leaf-A')
        initial.center = {
            kind: 'split',
            id: 'split-1',
            orientation: 'horizontal',
            sizes: [50, 50],
            children: [leaf('leaf-A', [tab('t1')], 't1'), leaf('leaf-B', [tab('t2')], 't2')],
        }
        initial.focusedLeafId = 'leaf-A'
        const store = makeStore({ initialState: initial })

        store.getState().activateTab({ kind: 'editor', leafId: 'leaf-B' }, 't2')
        expect(store.getState().focusedLeafId).toBe('leaf-B')
    })

    test('rebinds focus to the first leaf when the focused one is pruned', () => {
        const initial = makeInitial('leaf-A')
        initial.center = {
            kind: 'split',
            id: 'split-1',
            orientation: 'horizontal',
            sizes: [50, 50],
            children: [leaf('leaf-A', [tab('t1')], 't1'), leaf('leaf-B', [tab('t2')], 't2')],
        }
        initial.focusedLeafId = 'leaf-B'
        const store = makeStore({ initialState: initial })

        // Close the only tab in leaf-B — it gets pruned.
        store.getState().closeTab({ kind: 'editor', leafId: 'leaf-B' }, 't2')

        // After pruning, the split collapses to leaf-A. Focus must rebind.
        expect(store.getState().focusedLeafId).toBe('leaf-A')
    })
})

describe('workspace store — persistence', () => {
    let storage: Storage

    beforeEach(() => {
        storage = createMemoryStorage()
    })

    test('persists state changes to storage', () => {
        const store = makeStore({ storage })
        store.getState().setColumnSizes([10, 80, 10])

        const raw = storage.get(STORAGE_KEY)
        expect(raw).not.toBeNull()
        const parsed = JSON.parse(raw!)
        expect(parsed.state.columnSizes).toEqual([10, 80, 10])
    })

    test('restores state from storage on construction', () => {
        const first = makeStore({ storage })
        first.getState().setColumnSizes([5, 90, 5])

        // Now create a fresh store with the same storage; it should pick up the
        // persisted columnSizes (not the initial state).
        const second = makeStore({ storage })
        expect(second.getState().columnSizes).toEqual([5, 90, 5])
    })

    test('reset clears storage and reverts to initial state', () => {
        const initial = makeInitial('leaf-A')
        const store = makeStore({ initialState: initial, storage })
        store.getState().setColumnSizes([5, 90, 5])

        store.getState().reset()

        expect(store.getState().columnSizes).toEqual(initial.columnSizes)
        expect(storage.get(STORAGE_KEY)).toBeNull()
    })
})

describe('selectActiveContextTags', () => {
    test('always includes "global"', () => {
        const initial = makeInitial()
        const tags = selectActiveContextTags(initial)
        expect(tags.has('global')).toBe(true)
    })

    test('adds tool:<kind> for each distinct mounted tool tab', () => {
        const initial = makeInitial()
        initial.left.tabs.push(tab('t1', 'tool:files'))
        initial.right.tabs.push(tab('t2', 'tool:terminal'))
        initial.bottom.tabs.push(tab('t3', 'tool:files')) // duplicate kind

        const tags = selectActiveContextTags(initial)
        expect(tags.has('tool:files')).toBe(true)
        expect(tags.has('tool:terminal')).toBe(true)
    })

    test('adds editor:<kind> for the active tab in the focused leaf', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1', 'editor:text')], 't1')

        const tags = selectActiveContextTags(initial)
        expect(tags.has('editor:text')).toBe(true)
    })

    test('does not add editor:<kind> when the focused tab is a tool', () => {
        const initial = makeInitial('leaf-A')
        // A tool tab in the editor area would be unusual but the guard exists,
        // so test that it holds.
        initial.center = leaf('leaf-A', [tab('t1', 'tool:files')], 't1')

        const tags = selectActiveContextTags(initial)
        expect(tags.has('tool:files')).toBe(false) // tool tags only come from docks
        expect(tags.has('editor:tool:files')).toBe(false)
    })
})
