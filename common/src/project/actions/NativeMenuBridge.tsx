import { useEffect, useMemo, useRef } from 'react'

import { useProject, useSignal } from '../../model'
import { usePlatform } from '../../platform'
import { buildMenuPayload } from './menu-payload'

// Bridges `Project.actions.enabledActions` with the platform's native menu
// (desktop only).
//
// Two responsibilities, kept in separate effects so they don't churn each
// other:
//
//   1. Push the current menu payload to the host whenever the registered
//      actions or context-tag set change. A JSON-string equality check on
//      the previous emit skips no-op updates.
//
//   2. Subscribe to native-menu click events and dispatch them through the
//      action registry.

export function NativeMenuBridge() {
    const platform = usePlatform()
    const project = useProject()
    const actionsList = useSignal(project.actions.enabledActions)
    const lastJsonRef = useRef<string>('')

    const payload = useMemo(() => buildMenuPayload({ actions: actionsList }), [actionsList])

    useEffect(() => {
        const menu = platform.menu
        if (!menu) return
        const next = JSON.stringify(payload)
        if (next === lastJsonRef.current) return
        lastJsonRef.current = next
        menu.setItems(payload)
    }, [platform, payload])

    useEffect(() => {
        const menu = platform.menu
        if (!menu) return
        return menu.onInvoke((actionId) => {
            project.actions.run(actionId, { source: 'native-menu' })
        })
    }, [platform, project])

    return null
}
