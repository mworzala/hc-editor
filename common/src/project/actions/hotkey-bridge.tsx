import { useHotkey } from '@tanstack/react-hotkeys'

import { useActions } from './registry'
import { type Action } from './types'

// `useHotkey`'s first arg is a template-literal-typed `RegisterableHotkey`,
// not a bare `string`. We accept any string in our Action shape because
// keybinding sources are typically user-config / data. Cast at the boundary.
type HotkeyArg = Parameters<typeof useHotkey>[0]

// Bridges the action registry into @tanstack/react-hotkeys so any action
// with a `keybinding` field is automatically wired up. Drop one
// `<ActionHotkeyBridge />` inside the registry provider and the app's
// keyboard surface stays in lockstep with the registry.
//
// Note: context-tag filtering is added in Phase 2 (the bridge will consult
// `getActionContextSnapshot()` before invoking). For Phase 1 it just runs
// the `when` guard like the old `CommandHotkeyBridge` did.

export function ActionHotkeyBridge() {
    const actions = useActions()
    return (
        <>
            {actions
                .filter((a) => a.keybinding)
                .map((a) => (
                    <HotkeyBinding key={a.id} action={a} />
                ))}
        </>
    )
}

function HotkeyBinding({ action }: { action: Action }) {
    useHotkey(action.keybinding! as HotkeyArg, () => {
        if (action.when && !action.when()) return
        if (action.disabled) return
        void action.run({ source: 'hotkey' })
    })
    return null
}
