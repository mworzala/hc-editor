import { useHotkey } from '@tanstack/react-hotkeys'

import { actionMatchesContext, useActionContextSnapshot } from './context'
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
// Context filtering is enforced at invoke time (not at bind time) via a
// non-reactive snapshot of the active context set — so we don't re-bind every
// keystroke when focus moves between tools/editors.

export function ActionHotkeyBridge() {
    const actions = useActions()
    const getContextSnapshot = useActionContextSnapshot()
    return (
        <>
            {actions
                .filter((a) => a.keybinding)
                .map((a) => (
                    <HotkeyBinding
                        key={a.id}
                        action={a}
                        getContextSnapshot={getContextSnapshot}
                    />
                ))}
        </>
    )
}

function HotkeyBinding({
    action,
    getContextSnapshot,
}: {
    action: Action
    getContextSnapshot: () => ReadonlySet<string>
}) {
    useHotkey(action.keybinding! as HotkeyArg, () => {
        if (action.when && !action.when()) return
        if (action.disabled) return
        if (!actionMatchesContext(getContextSnapshot(), action.contexts)) return
        void action.run({ source: 'hotkey' })
    })
    return null
}
