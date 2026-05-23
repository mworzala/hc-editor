import { beforeEach, describe, expect, test } from 'bun:test'

import { createMemoryStorage, type Storage } from '../../platform'
import { STORAGE_VERSION } from '../../workspace/migrations'
import type { EditorGroupNode, Tab, WorkspaceState } from '../../workspace/types'
import { findLeaf, selectActiveContextTags } from './tree-helpers'
import { WorkspaceLayoutService } from './WorkspaceLayoutService'

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

function makeService(opts?: { initialState?: WorkspaceState; storage?: Storage }) {
    const storage = opts?.storage ?? createMemoryStorage()
    return new WorkspaceLayoutService({
        storage,
        storageKey: STORAGE_KEY,
        initialState: opts?.initialState ?? makeInitial(),
        persistDebounceMs: 0,
    })
}

const tab = (id: string, kind = 'editor:text', title = id): Tab => ({ id, kind, title })

describe('WorkspaceLayoutService — addTab', () => {
    test('adds a tab to a tool dock and activates it', () => {
        const svc = makeService()
        svc.addTab({ kind: 'tool', dock: 'left' }, tab('t1', 'tool:files', 'Files'))

        const left = svc.left.peek()
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

        const svc = makeService({ initialState: initial })
        svc.addTab({ kind: 'editor', leafId: 'leaf-B' }, tab('t1'))

        expect(svc.focusedLeafId.peek()).toBe('leaf-B')
        const leafB = findLeaf(svc.center.peek(), 'leaf-B')!
        expect(leafB.tabs).toHaveLength(1)
        expect(leafB.activeId).toBe('t1')
    })

    test('adding to a tool dock does not move editor focus', () => {
        const svc = makeService()
        const before = svc.focusedLeafId.peek()
        svc.addTab({ kind: 'tool', dock: 'left' }, tab('t1', 'tool:files'))
        expect(svc.focusedLeafId.peek()).toBe(before)
    })
})

describe('WorkspaceLayoutService — closeTab', () => {
    test('removes the tab and falls back to the previous tab as active', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2'), tab('t3')], 't2')
        const svc = makeService({ initialState: initial })

        svc.closeTab({ kind: 'editor', leafId: 'leaf-A' }, 't2')

        const leafA = findLeaf(svc.center.peek(), 'leaf-A')!
        expect(leafA.tabs.map((t) => t.id)).toEqual(['t1', 't3'])
        expect(leafA.activeId).toBe('t1')
    })

    test('preserves activeId if a non-active tab is closed', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't2')
        const svc = makeService({ initialState: initial })

        svc.closeTab({ kind: 'editor', leafId: 'leaf-A' }, 't1')

        const leafA = findLeaf(svc.center.peek(), 'leaf-A')!
        expect(leafA.activeId).toBe('t2')
    })
})

describe('WorkspaceLayoutService — moveTab', () => {
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
        const svc = makeService({ initialState: initial })

        svc.moveTab(
            { kind: 'editor', leafId: 'leaf-A' },
            { kind: 'editor', leafId: 'leaf-B' },
            't1',
            1,
        )

        const leafB = findLeaf(svc.center.peek(), 'leaf-B')!
        expect(leafB.tabs.map((t) => t.id)).toEqual(['t2', 't1'])
        expect(leafB.activeId).toBe('t1')
        expect(svc.focusedLeafId.peek()).toBe('leaf-B')
        expect(findLeaf(svc.center.peek(), 'leaf-A')).toBeNull()
    })

    test('is a no-op when the source does not contain the tab', () => {
        const svc = makeService()
        const before = svc.center.peek()
        svc.moveTab(
            { kind: 'editor', leafId: 'leaf-center' },
            { kind: 'editor', leafId: 'leaf-center' },
            'nope',
            0,
        )
        expect(svc.center.peek()).toBe(before)
    })
})

describe('WorkspaceLayoutService — splitLeafWithTab', () => {
    test('moves the tab into a freshly split sibling leaf', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't2')
        const svc = makeService({ initialState: initial })

        svc.splitLeafWithTab('leaf-A', 'right', { kind: 'editor', leafId: 'leaf-A' }, 't2')

        const root = svc.center.peek()
        expect(root.kind).toBe('split')
        if (root.kind !== 'split') throw new Error('unreachable')
        expect(root.orientation).toBe('horizontal')

        const [left, right] = root.children
        expect(left.kind).toBe('leaf')
        expect(right.kind).toBe('leaf')
        if (left.kind !== 'leaf' || right.kind !== 'leaf') throw new Error('unreachable')
        expect(left.tabs.map((t) => t.id)).toEqual(['t1'])
        expect(right.tabs.map((t) => t.id)).toEqual(['t2'])

        expect(svc.focusedLeafId.peek()).toBe(right.id)
    })

    test('side=top creates a vertical split with the new leaf above', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1'), tab('t2')], 't1')
        const svc = makeService({ initialState: initial })

        svc.splitLeafWithTab('leaf-A', 'top', { kind: 'editor', leafId: 'leaf-A' }, 't2')

        const root = svc.center.peek()
        if (root.kind !== 'split') throw new Error('expected split')
        expect(root.orientation).toBe('vertical')

        const [top] = root.children
        if (top.kind !== 'leaf') throw new Error('expected leaf')
        expect(top.tabs.map((t) => t.id)).toEqual(['t2'])
    })
})

describe('WorkspaceLayoutService — updateTab', () => {
    test('patches title and payload across every dock/leaf where the id appears', () => {
        const initial = makeInitial('leaf-A')
        initial.center = leaf('leaf-A', [tab('t1', 'editor:text', 'Old')], 't1')
        const svc = makeService({ initialState: initial })

        svc.updateTab('t1', { title: 'New', payload: { path: 'src/foo.luau' } })

        const leafA = findLeaf(svc.center.peek(), 'leaf-A')!
        expect(leafA.tabs[0]!.title).toBe('New')
        expect(leafA.tabs[0]!.payload).toEqual({ path: 'src/foo.luau' })
    })
})

describe('WorkspaceLayoutService — focus tracking', () => {
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
        const svc = makeService({ initialState: initial })

        svc.activateTab({ kind: 'editor', leafId: 'leaf-B' }, 't2')
        expect(svc.focusedLeafId.peek()).toBe('leaf-B')
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
        const svc = makeService({ initialState: initial })

        svc.closeTab({ kind: 'editor', leafId: 'leaf-B' }, 't2')

        expect(svc.focusedLeafId.peek()).toBe('leaf-A')
    })
})

describe('WorkspaceLayoutService — persistence', () => {
    let storage: Storage

    beforeEach(() => {
        storage = createMemoryStorage()
    })

    test('persists state changes to storage', () => {
        const svc = makeService({ storage })
        svc.setColumnSizes([10, 80, 10])

        const raw = storage.get(STORAGE_KEY)
        expect(raw).not.toBeNull()
        const parsed = JSON.parse(raw!)
        expect(parsed.state.columnSizes).toEqual([10, 80, 10])
    })

    test('restores state from storage on construction', () => {
        const first = makeService({ storage })
        first.setColumnSizes([5, 90, 5])

        const second = makeService({ storage })
        expect(second.columnSizes.peek()).toEqual([5, 90, 5])
    })

    test('reset clears storage and reverts to initial state', () => {
        const initial = makeInitial('leaf-A')
        const svc = makeService({ initialState: initial, storage })
        svc.setColumnSizes([5, 90, 5])

        svc.reset()

        expect(svc.columnSizes.peek()).toEqual(initial.columnSizes)
        expect(storage.get(STORAGE_KEY)).toBeNull()
    })
})

describe('WorkspaceLayoutService — corrupt persisted state recovery', () => {
    const poison: Array<[string, string]> = [
        ['not json', '{not json'],
        ['structurally empty', JSON.stringify({ version: STORAGE_VERSION, state: {} })],
        ['future version after a downgrade', JSON.stringify({ version: 99, state: makeInitial() })],
        [
            'truncated valid blob',
            JSON.stringify({ version: STORAGE_VERSION, state: makeInitial() }).slice(0, 80),
        ],
        [
            'wrong-typed field',
            JSON.stringify({
                version: STORAGE_VERSION,
                state: { ...makeInitial(), columnSizes: 'wide' },
            }),
        ],
        [
            'missing intermediate migration (version 0)',
            JSON.stringify({ version: 0, state: makeInitial() }),
        ],
    ]

    test.each(poison)('boots to default layout for %s and drops the blob', (_label, raw) => {
        const storage = createMemoryStorage()
        storage.set(STORAGE_KEY, raw)

        const initial = makeInitial('leaf-default')
        const svc = makeService({ initialState: initial, storage })

        expect(svc.columnSizes.peek()).toEqual(initial.columnSizes)
        expect(svc.center.peek()).toEqual(initial.center)
        expect(storage.get(STORAGE_KEY)).toBeNull()
    })

    test('valid persisted state is still restored (guard is not over-eager)', () => {
        const storage = createMemoryStorage()
        const first = makeService({ storage })
        first.setColumnSizes([5, 90, 5])

        const second = makeService({ storage })
        expect(second.columnSizes.peek()).toEqual([5, 90, 5])
        expect(storage.get(STORAGE_KEY)).not.toBeNull()
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
        initial.bottom.tabs.push(tab('t3', 'tool:files'))

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
        initial.center = leaf('leaf-A', [tab('t1', 'tool:files')], 't1')

        const tags = selectActiveContextTags(initial)
        expect(tags.has('tool:files')).toBe(false)
        expect(tags.has('editor:tool:files')).toBe(false)
    })
})

describe('WorkspaceLayoutService — disposal', () => {
    test('dispose is idempotent', () => {
        const svc = makeService()
        svc.dispose()
        svc.dispose()
    })

    test('after dispose no further persistence writes happen', () => {
        const storage = createMemoryStorage()
        const svc = new WorkspaceLayoutService({
            storage,
            storageKey: STORAGE_KEY,
            initialState: makeInitial(),
            persistDebounceMs: 0,
        })
        svc.setColumnSizes([10, 80, 10])
        const before = storage.get(STORAGE_KEY)
        svc.dispose()
        svc.setColumnSizes([20, 60, 20])
        expect(storage.get(STORAGE_KEY)).toBe(before!)
    })
})
