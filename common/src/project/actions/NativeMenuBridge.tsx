import { useEffect, useRef } from 'react'

import { usePlatform } from '../../platform'
import { useActionContextSet } from './context'
import { buildMenuPayload } from './menu-payload'
import { useActions, useRunAction } from './registry'

// Bridges the action registry with the platform's native menu (desktop only).
//
// Two responsibilities, kept in separate effects so they don't churn each
// other:
//
//   1. Push the current menu payload to the host whenever the registered
//      actions or context-tag set change. A JSON-string equality check on
//      the previous emit skips no-op updates (common during render thrash).
//
//   2. Subscribe to native-menu click events and dispatch them through the
//      action registry's context-aware runner.
//
// Renders nothing — mounted once inside `<ActionRegistryProvider>` +
// `<ActionContextProvider>` so both hooks have a source.

export function NativeMenuBridge() {
    const platform = usePlatform()
    const actions = useActions()
    const contextSet = useActionContextSet()
    const runAction = useRunAction()
    const lastJsonRef = useRef<string>('')

    useEffect(() => {
        const menu = platform.menu
        if (!menu) return
        const items = buildMenuPayload({ actions, contextSet })
        const next = JSON.stringify(items)
        if (next === lastJsonRef.current) return
        lastJsonRef.current = next
        menu.setItems(items)
    }, [platform, actions, contextSet])

    useEffect(() => {
        const menu = platform.menu
        if (!menu) return
        return menu.onInvoke((actionId) => {
            runAction(actionId, { source: 'native-menu' })
        })
    }, [platform, runAction])

    return null
}
