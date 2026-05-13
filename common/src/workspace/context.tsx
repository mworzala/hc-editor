import { createContext, useContext, type ReactNode } from 'react'
import { type StoreApi, type UseBoundStore } from 'zustand'

import { type WorkspaceStore } from './store'
import { type DockId, type Tab, type TabRegistry } from './types'

// Removes prop-drilling of `useStore` and `tabRegistry` through Workspace →
// ShellLayout → EditorGroup/ToolDock → leaf.

export type WorkspaceStoreHook = UseBoundStore<StoreApi<WorkspaceStore>>

type WorkspaceContextValue = {
    useStore: WorkspaceStoreHook
    tabRegistry: TabRegistry
    renderEmpty?: (dockId: DockId) => ReactNode
    /** Rendered at the end of a tool dock's tab bar (when it has tabs). */
    renderToolDockAdd?: (dockId: DockId) => ReactNode
    /** Optional host callback fired on right-click of a tab. The host decides
     *  what menu to render (workspace primitive stays menu-agnostic). */
    onTabContextMenu?: (info: { paneId: string; tabId: string; x: number; y: number }) => void
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
    value,
    children,
}: {
    value: WorkspaceContextValue
    children: ReactNode
}) {
    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspaceContext(): WorkspaceContextValue {
    const ctx = useContext(WorkspaceContext)
    if (!ctx) {
        throw new Error('useWorkspaceContext must be used inside <Workspace>')
    }
    return ctx
}

/** Render a tab via the host-supplied registry, falling back to a placeholder
 *  when the kind isn't registered. */
export function renderTabViaRegistry(registry: TabRegistry, tab: Tab): ReactNode {
    const renderer = registry[tab.kind]
    if (renderer) return renderer(tab)
    return (
        <div className='text-muted-foreground p-4 text-xs'>
            Unknown tab kind: <code>{tab.kind}</code>
        </div>
    )
}
