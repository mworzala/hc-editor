// Command registry — the single source of truth for "things the user can do".
// Commands have a stable id (for analytics + keybinding lookup), a title (for
// the command palette), an optional group, an optional keybinding string
// (passed verbatim to @tanstack/react-hotkeys), an optional `when` guard, and
// a handler.
//
// Producers register commands via `useRegisterCommand(...)` or by passing them
// to `<CommandRegistryProvider initialCommands={[...]}>`. Consumers (command
// palette, hotkey bridge) read them via `useCommands()`.

export type CommandContext = {
    /** Free-form data the caller can attach when invoking. */
    args?: Record<string, unknown>
}

export type Command = {
    id: string
    title: string
    /** Optional grouping for command-palette UI. Default `'general'`. */
    group?: string
    /** Keybinding string. Format follows @tanstack/react-hotkeys
     *  (e.g. `'$mod+p'`, `'shift+f5'`). */
    keybinding?: string
    /** Predicate: when this returns false the command is hidden from palette
     *  listings and the hotkey is treated as inactive. Receives no args —
     *  consumers should pull state from their own hooks. */
    when?: () => boolean
    run: (ctx?: CommandContext) => void
}
