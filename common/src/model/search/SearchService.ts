// `SearchService` — pluggable source registry.
//
// Each domain service that contributes a search source registers a
// descriptor `{ id, title }` at construction. The popup iterates
// `sources` to render its tab strip; the per-source data-fetching hooks
// stay popup-side (keyed by id) so this layer doesn't have to express
// React state itself.
//
// Re-registration of the same id replaces the prior descriptor. The
// disposer returned by `register` is the canonical removal path; it
// only removes the entry it installed (defends against racy re-registers
// in the same way `ActionRegistry` does).

import { computed, signal, type ReadonlySignal } from '../foundation/signal'

export type SearchSource = {
    id: string
    title: string
}

export class SearchService {
    private readonly _sources = signal<ReadonlyMap<string, SearchSource>>(new Map())

    /** Registered sources in registration order. */
    readonly sources: ReadonlySignal<readonly SearchSource[]> = computed(() => [
        ...this._sources.value.values(),
    ])

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

    dispose(): void {
        this._sources.value = new Map()
    }
}
