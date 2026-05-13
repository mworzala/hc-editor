import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react'

import { type Command, type CommandContext } from './registry'

// Storing commands in a Zustand-style ref-with-version dance instead of plain
// React state because:
//
//  • Producers may live deep in the tree (a tool's panel registering its own
//    commands) and we don't want re-registration to cause re-renders for
//    consumers that only need lookup.
//
//  • Hotkey-bridge needs a stable identity for the command list so we don't
//    re-bind every keystroke.

type CommandRegistryValue = {
    register: (cmd: Command) => () => void
    unregister: (id: string) => void
    run: (id: string, ctx?: CommandContext) => boolean
    list: () => readonly Command[]
    /** Bumped on every change so consumers can opt-in to re-render. */
    version: number
}

const CommandRegistryContext = createContext<CommandRegistryValue | null>(null)

type ProviderProps = {
    children: ReactNode
    initialCommands?: readonly Command[]
}

export function CommandRegistryProvider({ children, initialCommands }: ProviderProps) {
    const commandsRef = useRef<Map<string, Command>>(
        new Map(initialCommands?.map((c) => [c.id, c])),
    )
    const [version, setVersion] = useState(0)
    const bump = useCallback(() => setVersion((v) => v + 1), [])

    const value = useMemo<CommandRegistryValue>(
        () => ({
            register: (cmd) => {
                commandsRef.current.set(cmd.id, cmd)
                bump()
                return () => {
                    if (commandsRef.current.get(cmd.id) === cmd) {
                        commandsRef.current.delete(cmd.id)
                        bump()
                    }
                }
            },
            unregister: (id) => {
                if (commandsRef.current.delete(id)) bump()
            },
            run: (id, ctx) => {
                const cmd = commandsRef.current.get(id)
                if (!cmd) return false
                if (cmd.when && !cmd.when()) return false
                cmd.run(ctx)
                return true
            },
            list: () => Array.from(commandsRef.current.values()),
            version,
        }),
        [bump, version],
    )

    return (
        <CommandRegistryContext.Provider value={value}>{children}</CommandRegistryContext.Provider>
    )
}

function useCommandRegistry(): CommandRegistryValue {
    const ctx = useContext(CommandRegistryContext)
    if (!ctx) {
        throw new Error('useCommandRegistry must be used inside <CommandRegistryProvider>')
    }
    return ctx
}

/** Register a command for the lifetime of the calling component. The command
 *  is removed when the component unmounts. Re-registers when the command
 *  identity changes (compared by identity — wrap handlers in `useCallback`).
 *
 *  Reads the registry via a ref so that bumps from `register` itself don't
 *  re-trigger the effect (which would otherwise spin in an unregister →
 *  bump → re-register loop). */
export function useRegisterCommand(command: Command) {
    const registry = useCommandRegistry()
    const registryRef = useRef(registry)
    registryRef.current = registry
    useEffect(() => {
        return registryRef.current.register(command)
    }, [command])
}

/** Snapshot of all commands. Re-renders on each registration change. */
export function useCommands(): readonly Command[] {
    const registry = useCommandRegistry()
    // Read `version` to subscribe to changes.
    return useMemo(() => registry.list(), [registry])
}

/** Run a command by id. Returns true on success, false if not found or guarded. */
export function useRunCommand(): (id: string, ctx?: CommandContext) => boolean {
    const registry = useCommandRegistry()
    return useCallback((id, ctx) => registry.run(id, ctx), [registry])
}
