import { useSignal } from '../foundation/react'
import { useProject } from '../foundation/react'
import type { SearchSource } from './SearchService'

export function useSearchService() {
    return useProject().search
}

export function useSearchSources(): readonly SearchSource[] {
    return useSignal(useProject().search.sources)
}
