import { useMemo } from 'react'

import { useProject, useSignal } from '../../../model'
import { fuzzyScore } from '../fuzzy'
import { type SearchResult } from '../types'

/** Fuzzy-match the current action registry against `query`. `enabledActions`
 *  is already filtered by when-clauses, so no extra context-tag check. */
export function useActionResults(query: string, limit = 50): SearchResult[] {
    const actions = useSignal(useProject().actions.enabledActions)

    return useMemo(() => {
        const results: SearchResult[] = []
        for (const action of actions) {
            const match = fuzzyScore(query, action.title)
            if (!match) continue
            results.push({
                kind: 'action',
                id: `action:${action.id}`,
                title: action.title,
                subtitle: action.group,
                keybinding: action.keybinding,
                matches: match.matches,
                score: match.score,
                data: action,
            })
        }
        results.sort((a, b) => b.score - a.score)
        return results.slice(0, limit)
    }, [actions, query, limit])
}
