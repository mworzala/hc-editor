import { useCallback, useMemo } from 'react'

import { useDoubleTapKey } from '../actions/double-tap'
import { useRegisterAction } from '../actions/registry'
import { type Action } from '../actions/types'
import { useSearchStore } from './search-store'

// Registers the three "open search" actions and wires the double-tap-Shift
// gesture for the "All" tab. Returns null — this is a render-only component
// that exists so it can sit inside ActionRegistryProvider.

export function SearchActions() {
    const openWith = useSearchStore((s) => s.openWith)

    const openAll = useCallback(() => openWith('all'), [openWith])
    const openActions = useCallback(() => openWith('actions'), [openWith])
    const openFiles = useCallback(() => openWith('files'), [openWith])
    const openSymbols = useCallback(() => openWith('symbols'), [openWith])
    const openText = useCallback(() => openWith('text'), [openWith])

    const allAction = useMemo<Action>(
        () => ({
            id: 'search.openAll',
            title: 'Search Everywhere',
            group: 'search',
            contexts: ['global'],
            menu: { path: 'edit', group: 'search', order: 10 },
            run: openAll,
        }),
        [openAll],
    )
    const actionsAction = useMemo<Action>(
        () => ({
            id: 'search.openActions',
            title: 'Find Action…',
            group: 'search',
            keybinding: 'f1',
            contexts: ['global'],
            menu: { path: 'edit', group: 'search', order: 20 },
            run: openActions,
        }),
        [openActions],
    )
    const filesAction = useMemo<Action>(
        () => ({
            id: 'search.openFiles',
            title: 'Go to File…',
            group: 'search',
            keybinding: '$mod+shift+o',
            contexts: ['global'],
            menu: { path: 'edit', group: 'search', order: 30 },
            run: openFiles,
        }),
        [openFiles],
    )
    const symbolsAction = useMemo<Action>(
        () => ({
            id: 'search.openSymbols',
            title: 'Go to Symbol…',
            group: 'search',
            keybinding: '$mod+t',
            contexts: ['global'],
            run: openSymbols,
        }),
        [openSymbols],
    )
    const textAction = useMemo<Action>(
        () => ({
            id: 'search.openText',
            title: 'Find in Files…',
            group: 'search',
            keybinding: '$mod+shift+f',
            contexts: ['global'],
            menu: { path: 'edit', group: 'search', order: 40 },
            run: openText,
        }),
        [openText],
    )

    useRegisterAction(allAction)
    useRegisterAction(actionsAction)
    useRegisterAction(filesAction)
    useRegisterAction(symbolsAction)
    useRegisterAction(textAction)

    useDoubleTapKey('Shift', openAll, { windowMs: 350 })

    return null
}
