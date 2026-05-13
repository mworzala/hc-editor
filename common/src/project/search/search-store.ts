import { create } from 'zustand'

import { type SearchTab } from './types'

// Tiny store for the search popup so the double-tap hook and the F1/Cmd+Shift+O
// actions can open it from outside the popup's React subtree without prop
// drilling.

type SearchState = {
    open: boolean
    tab: SearchTab
    query: string
    openWith: (tab: SearchTab) => void
    close: () => void
    setQuery: (query: string) => void
    setTab: (tab: SearchTab) => void
}

export const useSearchStore = create<SearchState>((set) => ({
    open: false,
    tab: 'all',
    query: '',
    openWith: (tab) => set({ open: true, tab, query: '' }),
    close: () => set({ open: false }),
    setQuery: (query) => set({ query }),
    setTab: (tab) => set({ tab }),
}))
