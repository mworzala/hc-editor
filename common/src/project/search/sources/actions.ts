import { useMemo } from 'react'

import { actionMatchesContext, useActionContextSet } from '../../actions/context'
import { useActions } from '../../actions/registry'
import { fuzzyScore } from '../fuzzy'
import { type SearchResult } from '../types'

/** Fuzzy-match the current action registry against `query`. Filters by the
 *  active context tag set (an action hidden by context isn't searchable). */
export function useActionResults(query: string, limit = 50): SearchResult[] {
    const actions = useActions()
    const activeCtx = useActionContextSet()

    return useMemo(() => {
        const results: SearchResult[] = []
        for (const action of actions) {
            if (action.when && !action.when()) continue
            if (!actionMatchesContext(activeCtx, action.contexts)) continue
            const match = fuzzyScore(query, action.title)
            if (!match) continue
            results.push({
                kind: 'action',
                id: `action:${action.id}`,
                title: action.title,
                subtitle: action.group,
                icon: action.icon,
                keybinding: action.keybinding,
                matches: match.matches,
                score: match.score,
                data: action,
            })
        }
        results.sort((a, b) => b.score - a.score)
        return results.slice(0, limit)
    }, [actions, activeCtx, query, limit])
}
