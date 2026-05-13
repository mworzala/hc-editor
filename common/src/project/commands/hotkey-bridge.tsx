import { useHotkey } from '@tanstack/react-hotkeys'

import { useCommands } from './context'
import { type Command } from './registry'

// `useHotkey`'s first arg is a template-literal-typed `RegisterableHotkey`,
// not a bare `string`. We accept any string in our Command shape because
// keybinding sources are typically user-config / data. Cast at the boundary.
type HotkeyArg = Parameters<typeof useHotkey>[0]

// Bridges the command registry into @tanstack/react-hotkeys so any command
// with a `keybinding` field is automatically wired up. Drop one
// `<CommandHotkeyBridge />` inside the registry provider and the app's
// keyboard surface stays in lockstep with the registry.

export function CommandHotkeyBridge() {
    const commands = useCommands()
    return (
        <>
            {commands
                .filter((c) => c.keybinding)
                .map((c) => (
                    <HotkeyBinding key={c.id} command={c} />
                ))}
        </>
    )
}

function HotkeyBinding({ command }: { command: Command }) {
    useHotkey(command.keybinding! as HotkeyArg, () => {
        if (command.when && !command.when()) return
        command.run()
    })
    return null
}
