// `SearchService` — pluggable source registry + popup state owner.
//
// Two responsibilities:
//
//   • Source registry: each domain service that contributes a search source
//     registers a descriptor `{ id, title }`. The popup iterates `sources` to
//     render its tab strip; the per-source data-fetching hooks stay popup-side
//     (keyed by id) so this layer doesn't have to express React state itself.
//
//   • Popup state: `popupOpen` / `popupTab` / `popupQuery` signals back the
//     search popup. The `search.open*` actions register here in the
//     constructor; calling `openWith(tab)` resets the query and opens. The
//     popup reads via `useSignal(...)` on each public signal.
//
// Re-registration of the same id replaces the prior descriptor. The
// disposer returned by `register` is the canonical removal path; it
// only removes the entry it installed (defends against racy re-registers
// in the same way `ActionRegistry` does).

import type { ActionRegistry } from '../actions/ActionRegistry'
import { computed, signal, type ReadonlySignal } from '../foundation/signal'

export type SearchSource = {
    id: string
    title: string
}

export type SearchTab = 'all' | 'actions' | 'files' | 'text' | 'symbols' | 'docs'

export interface SearchServiceDeps {
    actions: ActionRegistry
}

export class SearchService {
    private readonly _sources = signal<ReadonlyMap<string, SearchSource>>(new Map())
    private readonly _popupOpen = signal<boolean>(false)
    private readonly _popupTab = signal<SearchTab>('all')
    private readonly _popupQuery = signal<string>('')
    private readonly _actionDisposers: Array<() => void> = []

    /** Registered sources in registration order. */
    readonly sources: ReadonlySignal<readonly SearchSource[]> = computed(() => [
        ...this._sources.value.values(),
    ])

    readonly popupOpen: ReadonlySignal<boolean> = this._popupOpen
    readonly popupTab: ReadonlySignal<SearchTab> = this._popupTab
    readonly popupQuery: ReadonlySignal<string> = this._popupQuery

    constructor(private readonly deps: SearchServiceDeps) {
        this._registerActions()
    }

    register(source: SearchSource): () => void {
        const cur = this._sources.peek()
        const next = new Map(cur)
        next.set(source.id, source)
        this._sources.value = next
        return () => {
            const after = this._sources.peek()
            if (after.get(source.id) !== source) return
            const dispose = new Map(after)
            dispose.delete(source.id)
            this._sources.value = dispose
        }
    }

    get(id: string): SearchSource | undefined {
        return this._sources.peek().get(id)
    }

    list(): readonly SearchSource[] {
        return [...this._sources.peek().values()]
    }

    // === Popup state mutators ===

    openWith(tab: SearchTab): void {
        this._popupTab.value = tab
        this._popupQuery.value = ''
        this._popupOpen.value = true
    }

    close(): void {
        this._popupOpen.value = false
    }

    setTab(tab: SearchTab): void {
        this._popupTab.value = tab
    }

    setQuery(query: string): void {
        this._popupQuery.value = query
    }

    dispose(): void {
        for (const d of this._actionDisposers) d()
        this._actionDisposers.length = 0
        this._sources.value = new Map()
    }

    private _registerActions(): void {
        const reg = this.deps.actions
        this._actionDisposers.push(
            reg.register({
                id: 'search.openAll',
                title: 'Search Everywhere',
                group: 'search',
                menu: { path: 'edit', group: 'search', order: 10 },
                run: () => this.openWith('all'),
            }),
            reg.register({
                id: 'search.openActions',
                title: 'Find Action…',
                group: 'search',
                keybinding: 'f1',
                menu: { path: 'edit', group: 'search', order: 20 },
                run: () => this.openWith('actions'),
            }),
            reg.register({
                id: 'search.openFiles',
                title: 'Go to File…',
                group: 'search',
                keybinding: '$mod+shift+o',
                menu: { path: 'edit', group: 'search', order: 30 },
                run: () => this.openWith('files'),
            }),
            reg.register({
                id: 'search.openSymbols',
                title: 'Go to Symbol…',
                group: 'search',
                keybinding: '$mod+t',
                run: () => this.openWith('symbols'),
            }),
            reg.register({
                id: 'search.openText',
                title: 'Find in Files…',
                group: 'search',
                keybinding: '$mod+shift+f',
                menu: { path: 'edit', group: 'search', order: 40 },
                run: () => this.openWith('text'),
            }),
        )
    }
}
