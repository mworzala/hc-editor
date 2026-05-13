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

import { type Action, type ActionRunContext } from './types'

// Storing actions in a Zustand-style ref-with-version dance instead of plain
// React state because:
//
//  • Producers may live deep in the tree (a tool's panel registering its own
//    actions) and we don't want re-registration to cause re-renders for
//    consumers that only need lookup.
//
//  • Hotkey-bridge needs a stable identity for the action list so we don't
//    re-bind every keystroke.

type ActionRegistryValue = {
    register: (action: Action) => () => void
    unregister: (id: string) => void
    /** Invoke an action by id. Returns true on success, false if the action
     *  isn't registered or its `when` guard returned false. Context filtering
     *  is intentionally NOT applied here — callers (hotkey bridge, search
     *  popup) decide whether to consult `getActionContextSnapshot()` first. */
    run: (id: string, ctx: ActionRunContext) => boolean
    list: () => readonly Action[]
    get: (id: string) => Action | undefined
    /** Bumped on every change so consumers can opt-in to re-render. */
    version: number
}

const ActionRegistryContext = createContext<ActionRegistryValue | null>(null)

type ProviderProps = {
    children: ReactNode
    initialActions?: readonly Action[]
}

export function ActionRegistryProvider({ children, initialActions }: ProviderProps) {
    const actionsRef = useRef<Map<string, Action>>(
        new Map(initialActions?.map((a) => [a.id, a])),
    )
    const [version, setVersion] = useState(0)
    const bump = useCallback(() => setVersion((v) => v + 1), [])

    const value = useMemo<ActionRegistryValue>(
        () => ({
            register: (action) => {
                actionsRef.current.set(action.id, action)
                bump()
                return () => {
                    if (actionsRef.current.get(action.id) === action) {
                        actionsRef.current.delete(action.id)
                        bump()
                    }
                }
            },
            unregister: (id) => {
                if (actionsRef.current.delete(id)) bump()
            },
            run: (id, ctx) => {
                const action = actionsRef.current.get(id)
                if (!action) return false
                if (action.when && !action.when()) return false
                if (action.disabled) return false
                void action.run(ctx)
                return true
            },
            list: () => Array.from(actionsRef.current.values()),
            get: (id) => actionsRef.current.get(id),
            version,
        }),
        [bump, version],
    )

    return (
        <ActionRegistryContext.Provider value={value}>{children}</ActionRegistryContext.Provider>
    )
}

function useActionRegistry(): ActionRegistryValue {
    const ctx = useContext(ActionRegistryContext)
    if (!ctx) {
        throw new Error('useActionRegistry must be used inside <ActionRegistryProvider>')
    }
    return ctx
}

/** Register an action for the lifetime of the calling component. The action
 *  is removed when the component unmounts. Re-registers when the action
 *  identity changes (compared by identity — wrap handlers in `useCallback`).
 *
 *  Reads the registry via a ref so that bumps from `register` itself don't
 *  re-trigger the effect (which would otherwise spin in an unregister →
 *  bump → re-register loop). */
export function useRegisterAction(action: Action) {
    const registry = useActionRegistry()
    const registryRef = useRef(registry)
    registryRef.current = registry
    useEffect(() => {
        return registryRef.current.register(action)
    }, [action])
}

/** Snapshot of all actions. Re-renders on each registration change. */
export function useActions(): readonly Action[] {
    const registry = useActionRegistry()
    return useMemo(() => registry.list(), [registry])
}

/** Run an action by id. Returns true on success, false if not found or
 *  guarded. */
export function useRunAction(): (id: string, ctx: ActionRunContext) => boolean {
    const registry = useActionRegistry()
    return useCallback((id, ctx) => registry.run(id, ctx), [registry])
}
