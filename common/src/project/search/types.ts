import type { SymbolKind } from 'vscode-languageserver-types'

import type { MapFile } from '@hollowcube/api'

import type { Action } from '../../model/actions/types'
import type { SearchTab } from '../../model/search/SearchService'

export type { SearchTab }

export const SEARCH_TABS: readonly { id: SearchTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'actions', label: 'Actions' },
    { id: 'files', label: 'Files' },
    { id: 'symbols', label: 'Symbols' },
    { id: 'docs', label: 'Docs' },
    { id: 'text', label: 'Text Search' },
] as const

/** Discriminated union of a single result entry. Each variant carries the
 *  original data plus the score/match-indices from fuzzy matching. */
export type SearchResult =
    | {
          kind: 'action'
          id: string
          title: string
          subtitle?: string
          keybinding?: string
          matches: number[]
          score: number
          data: Action
      }
    | {
          kind: 'file'
          id: string
          title: string
          subtitle?: string
          matches: number[]
          score: number
          data: MapFile
      }
    | {
          kind: 'text'
          id: string
          title: string
          subtitle?: string
          /** Match positions inside the snippet text. */
          matches: number[]
          score: number
          data: { path: string; line: number; column: number; snippet: string }
      }
    | {
          kind: 'symbol'
          id: string
          title: string
          subtitle?: string
          matches: number[]
          score: number
          data: {
              name: string
              containerName?: string
              symbolKind: SymbolKind
              path: string
              /** 1-based line / 0-based column inside the target file. */
              line: number
              column: number
          }
      }
    | {
          kind: 'docs'
          id: string
          title: string
          subtitle?: string
          matches: number[]
          score: number
          /** `moduleId` is a library key or global moduleName; `symbol` is the
           *  focused member, or `null` for the module itself. */
          data: { moduleId: string; symbol: string | null }
      }

export type ResultGroup = {
    kind: SearchResult['kind']
    label: string
    items: readonly SearchResult[]
}
