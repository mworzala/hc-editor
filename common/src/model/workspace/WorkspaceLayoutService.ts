// `WorkspaceLayoutService` — owns the workspace layout (docks, splits,
// tabs, focus) as signals, replacing the Zustand store at
// `common/src/workspace/store.ts`. Action semantics are byte-for-byte
// preserved; the tests migrated from `store.test.ts` cover that explicitly.
//
// Persistence: schema-versioned + structurally validated, loaded on
// construction from `Storage`, written back on every persistable change
// via a debounced trailing-edge writer. Hot fields (resize sizes) tick
// ~60 times per second during a drag; without debouncing we'd serialize
// the whole layout on every pointermove.
//
// Transient drag state lives on the service too (drag-active tab,
// hovered pane) — the old store lifted it out of React local state so
// debug overlays / collaborative views can read it; we keep that.

import type { Storage } from '../../platform'
import type {
    ActiveDragState,
    DockId,
    EditorGroupNode,
    Tab,
    ToolDockState,
    WorkspaceState,
} from '../../workspace/types'
import { computed, signal, type ReadonlySignal } from '../foundation/signal'
import { readPersisted, writePersisted } from './persistence'
import {
    pruneEmptyLeaves,
    rebindFocusIfMissing,
    splitLeafInTree,
    updateDockOrLeaf,
    updateSplitSizes,
    patchTabEverywhere,
    type TabLocation,
} from './tree-helpers'

export interface WorkspaceLayoutServiceDeps {
    storage: Storage
    storageKey: string
    initialState: WorkspaceState
    /** Debounce window (ms) for persisted writes. Defaults to 75ms. Set
     *  to 0 for tests (synchronous writes). */
    persistDebounceMs?: number
}

export class WorkspaceLayoutService {
    // === Persisted slices ===
    private readonly _columnSizes = signal<readonly [number, number, number]>([22, 78, 0])
    private readonly _middleSizes = signal<readonly [number, number]>([100, 0])
    private readonly _docksVisible = signal<{
        left: boolean
        right: boolean
        bottom: boolean
    }>({ left: true, right: false, bottom: false })
    private readonly _left = signal<ToolDockState>({ tabs: [], activeId: null })
    private readonly _right = signal<ToolDockState>({ tabs: [], activeId: null })
    private readonly _bottom = signal<ToolDockState>({ tabs: [], activeId: null })
    private readonly _center = signal<EditorGroupNode>({
        kind: 'leaf',
        id: 'placeholder',
        tabs: [],
        activeId: null,
    })
    private readonly _focusedLeafId = signal<string | null>(null)

    // === Transient (not persisted) ===
    private readonly _activeDrag = signal<ActiveDragState | null>(null)
    private readonly _hoveredPaneId = signal<string | null>(null)

    // === Public read-only views ===
    readonly columnSizes: ReadonlySignal<readonly [number, number, number]> = this._columnSizes
    readonly middleSizes: ReadonlySignal<readonly [number, number]> = this._middleSizes
    readonly docksVisible: ReadonlySignal<{
        left: boolean
        right: boolean
        bottom: boolean
    }> = this._docksVisible
    readonly left: ReadonlySignal<ToolDockState> = this._left
    readonly right: ReadonlySignal<ToolDockState> = this._right
    readonly bottom: ReadonlySignal<ToolDockState> = this._bottom
    readonly center: ReadonlySignal<EditorGroupNode> = this._center
    readonly focusedLeafId: ReadonlySignal<string | null> = this._focusedLeafId
    readonly activeDrag: ReadonlySignal<ActiveDragState | null> = this._activeDrag
    readonly hoveredPaneId: ReadonlySignal<string | null> = this._hoveredPaneId

    /** Composite read of the full persistable state. Convenient for
     *  consumers that need a `WorkspaceState` snapshot (drag handlers,
     *  selectors). Recomputes whenever any persisted slice changes. */
    readonly state: ReadonlySignal<WorkspaceState> = computed(() => ({
        columnSizes: [...this._columnSizes.value] as [number, number, number],
        middleSizes: [...this._middleSizes.value] as [number, number],
        docksVisible: this._docksVisible.value,
        left: this._left.value,
        right: this._right.value,
        bottom: this._bottom.value,
        center: this._center.value,
        focusedLeafId: this._focusedLeafId.value,
    }))

    private readonly _debouncedWrite: (state: WorkspaceState) => void
    private _persistTimer: ReturnType<typeof setTimeout> | null = null
    private _disposed = false

    constructor(private readonly deps: WorkspaceLayoutServiceDeps) {
        const restored = readPersisted(deps.storage, deps.storageKey)
        this._installState(restored ?? deps.initialState)
        this._debouncedWrite = makeDebouncedWrite(
            (state) => writePersisted(deps.storage, deps.storageKey, state),
            deps.persistDebounceMs ?? 75,
            (t) => {
                this._persistTimer = t
            },
        )
    }

    // === Sizing ===

    setColumnSizes(sizes: [number, number, number]): void {
        this._columnSizes.value = sizes
        this._persist()
    }

    setMiddleSizes(sizes: [number, number]): void {
        this._middleSizes.value = sizes
        this._persist()
    }

    setLeafSplitSizes(splitId: string, sizes: [number, number]): void {
        this._center.value = updateSplitSizes(this._center.peek(), splitId, sizes)
        this._persist()
    }

    // === Tab membership ===

    addTab(loc: TabLocation, tab: Tab): void {
        const next = updateDockOrLeaf(this._snapshot(), loc, (d) => ({
            ...d,
            tabs: [...d.tabs, tab],
            activeId: tab.id,
        }))
        if (loc.kind === 'editor') {
            this._installState({ ...next, focusedLeafId: loc.leafId })
        } else {
            this._installState(next)
        }
        this._persist()
    }

    activateTab(loc: TabLocation, tabId: string): void {
        const next = updateDockOrLeaf(this._snapshot(), loc, (d) => ({ ...d, activeId: tabId }))
        if (loc.kind === 'editor') {
            this._installState({ ...next, focusedLeafId: loc.leafId })
        } else {
            this._installState(next)
        }
        this._persist()
    }

    closeTab(loc: TabLocation, tabId: string): void {
        const next = updateDockOrLeaf(this._snapshot(), loc, (d) => {
            const tabs = d.tabs.filter((t) => t.id !== tabId)
            const activeId =
                d.activeId === tabId
                    ? (tabs[Math.max(0, d.tabs.findIndex((t) => t.id === tabId) - 1)]?.id ?? null)
                    : d.activeId
            return { ...d, tabs, activeId }
        })
        if (loc.kind !== 'editor') {
            this._installState(next)
        } else {
            const pruned = pruneEmptyLeaves(next)
            this._installState(rebindFocusIfMissing(pruned))
        }
        this._persist()
    }

    updateTab(tabId: string, patch: Partial<Omit<Tab, 'id'>>): void {
        this._installState(patchTabEverywhere(this._snapshot(), tabId, patch))
        this._persist()
    }

    reorderTabs(loc: TabLocation, fromIdx: number, toIdx: number): void {
        this._installState(
            updateDockOrLeaf(this._snapshot(), loc, (d) => {
                const tabs = d.tabs.slice()
                const [moved] = tabs.splice(fromIdx, 1)
                if (moved) tabs.splice(toIdx, 0, moved)
                return { ...d, tabs }
            }),
        )
        this._persist()
    }

    moveTab(from: TabLocation, to: TabLocation, tabId: string, targetIndex: number): void {
        let movedTab: Tab | null = null
        const removed = updateDockOrLeaf(this._snapshot(), from, (d) => {
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
        if (!movedTab) return

        const inserted = updateDockOrLeaf(removed, to, (d) => {
            const tabs = d.tabs.slice()
            const idx = Math.max(0, Math.min(targetIndex, tabs.length))
            tabs.splice(idx, 0, movedTab!)
            return { ...d, tabs, activeId: movedTab!.id }
        })

        const finalState =
            to.kind === 'editor' ? { ...inserted, focusedLeafId: to.leafId } : inserted
        const next =
            from.kind === 'editor' || to.kind === 'editor'
                ? rebindFocusIfMissing(pruneEmptyLeaves(finalState))
                : finalState
        this._installState(next)
        this._persist()
    }

    splitLeafWithTab(
        leafId: string,
        side: 'left' | 'right' | 'top' | 'bottom',
        from: TabLocation,
        tabId: string,
    ): void {
        let movedTab: Tab | null = null
        let next = updateDockOrLeaf(this._snapshot(), from, (d) => {
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
        if (!movedTab) return

        let newLeafId: string | null = null
        next = {
            ...next,
            center: splitLeafInTree(next.center, leafId, side, movedTab, (id) => {
                newLeafId = id
            }),
        }
        const pruned = rebindFocusIfMissing(pruneEmptyLeaves(next))
        this._installState(newLeafId ? { ...pruned, focusedLeafId: newLeafId } : pruned)
        this._persist()
    }

    // === Docks ===

    toggleDock(dock: DockId): void {
        const cur = this._docksVisible.peek()
        this._docksVisible.value = { ...cur, [dock]: !cur[dock] }
        this._persist()
    }

    setDockVisible(dock: DockId, visible: boolean): void {
        const cur = this._docksVisible.peek()
        this._docksVisible.value = { ...cur, [dock]: visible }
        this._persist()
    }

    // === Focus ===

    setFocusedLeaf(leafId: string | null): void {
        this._focusedLeafId.value = leafId
        this._persist()
    }

    // === Transient drag state (not persisted) ===

    setActiveDrag(drag: ActiveDragState | null): void {
        this._activeDrag.value = drag
    }

    setHoveredPaneId(paneId: string | null): void {
        this._hoveredPaneId.value = paneId
    }

    // === Persistence ===

    /** Drop the persisted blob and revert to the initial state passed at
     *  construction. Mirrors the old Zustand store's `reset` action. */
    reset(): void {
        this.deps.storage.remove(this.deps.storageKey)
        this._installState(this.deps.initialState)
        this._activeDrag.value = null
        this._hoveredPaneId.value = null
    }

    dispose(): void {
        if (this._disposed) return
        this._disposed = true
        if (this._persistTimer) {
            clearTimeout(this._persistTimer)
            this._persistTimer = null
        }
    }

    // === Internals ===

    private _snapshot(): WorkspaceState {
        return {
            columnSizes: [...this._columnSizes.peek()] as [number, number, number],
            middleSizes: [...this._middleSizes.peek()] as [number, number],
            docksVisible: this._docksVisible.peek(),
            left: this._left.peek(),
            right: this._right.peek(),
            bottom: this._bottom.peek(),
            center: this._center.peek(),
            focusedLeafId: this._focusedLeafId.peek(),
        }
    }

    private _installState(state: WorkspaceState): void {
        this._columnSizes.value = state.columnSizes
        this._middleSizes.value = state.middleSizes
        this._docksVisible.value = state.docksVisible
        this._left.value = state.left
        this._right.value = state.right
        this._bottom.value = state.bottom
        this._center.value = state.center
        this._focusedLeafId.value = state.focusedLeafId
    }

    private _persist(): void {
        if (this._disposed) return
        this._debouncedWrite(this._snapshot())
    }
}

function makeDebouncedWrite(
    fn: (state: WorkspaceState) => void,
    wait: number,
    setTimerRef: (t: ReturnType<typeof setTimeout> | null) => void,
): (state: WorkspaceState) => void {
    if (wait <= 0) return fn
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastState: WorkspaceState | null = null
    return (state) => {
        lastState = state
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
            timer = null
            setTimerRef(null)
            if (lastState) fn(lastState)
        }, wait)
        setTimerRef(timer)
    }
}
