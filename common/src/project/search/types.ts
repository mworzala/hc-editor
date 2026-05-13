import type { ReactNode } from 'react'

import type { ProjectFile } from '@hollowcube/api'

import type { Action } from '../actions/types'

export type SearchTab = 'all' | 'actions' | 'files' | 'text'

export const SEARCH_TABS: readonly { id: SearchTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'actions', label: 'Actions' },
    { id: 'files', label: 'Files' },
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
          icon?: ReactNode
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
          data: ProjectFile
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

export type ResultGroup = {
    kind: SearchResult['kind']
    label: string
    items: readonly SearchResult[]
}
