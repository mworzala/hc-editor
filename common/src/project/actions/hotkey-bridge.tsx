import { useHotkey } from '@tanstack/react-hotkeys'

import { useProject, useSignal } from '../../model'
import { type Action } from '../../model/actions/types'

// Bridges `Project.actions.enabledActions` into @tanstack/react-hotkeys —
// any enabled action with a `keybinding` field is automatically wired.
// `enabledActions` is already filtered by when-clauses, so the binding's
// invocation handler just dispatches through `actions.run(id)`.
//
// `useHotkey`'s first arg is a template-literal-typed `RegisterableHotkey`,
// not a bare `string`. Action keybinding sources are user-config / data, so
// we cast at the boundary.
type HotkeyArg = Parameters<typeof useHotkey>[0]

export function ActionHotkeyBridge() {
    const enabled = useSignal(useProject().actions.enabledActions)
    return (
        <>
            {enabled
                .filter((a) => a.keybinding)
                .map((a) => (
                    <HotkeyBinding key={a.id} action={a} />
                ))}
        </>
    )
}

function HotkeyBinding({ action }: { action: Action }) {
    const actions = useProject().actions
    useHotkey(action.keybinding! as HotkeyArg, () => {
        actions.run(action.id, { source: 'hotkey' })
    })
    return null
}
