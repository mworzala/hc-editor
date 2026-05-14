import {
    createContext,
    useContext,
    useMemo,
    useSyncExternalStore,
    type ReactNode,
} from 'react'

import { LspUiBus } from './lsp-ui-bus'

const LspUiContext = createContext<LspUiBus | null>(null)

export function LspUiProvider({ children }: { children: ReactNode }) {
    const bus = useMemo(() => new LspUiBus(), [])
    return <LspUiContext.Provider value={bus}>{children}</LspUiContext.Provider>
}

export function useLspUiBus(): LspUiBus {
    const ctx = useContext(LspUiContext)
    if (!ctx) throw new Error('useLspUiBus must be used inside <LspUiProvider>')
    return ctx
}

export function useLspUiSnapshot() {
    const bus = useLspUiBus()
    return useSyncExternalStore(
        (cb) => bus.subscribe(cb),
        () => bus.getSnapshot(),
        () => bus.getSnapshot(),
    )
}
