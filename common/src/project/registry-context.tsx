import { createContext, useContext, useMemo, type ReactNode } from 'react'

import { type TabRegistry } from '../workspace'
import { buildTabRegistry, type AnyEditorDefinition, type ToolDefinition } from './registry'

// Keeps the tool and editor lists addressable as themselves (so the command
// palette, file opener, etc. can introspect them) instead of being collapsed
// to a flat `kind → render` map. The flat map is still built for the
// workspace primitive's `tabRegistry` prop.

type RegistryContextValue = {
    tools: readonly ToolDefinition[]
    editors: readonly AnyEditorDefinition[]
    /** Flat `kind → render` adapter consumed by the Workspace primitive. */
    tabRegistry: TabRegistry
}

const RegistryContext = createContext<RegistryContextValue | null>(null)

type RegistryProviderProps = {
    tools: readonly ToolDefinition[]
    editors: readonly AnyEditorDefinition[]
    children: ReactNode
}

export function RegistryProvider({ tools, editors, children }: RegistryProviderProps) {
    const value = useMemo<RegistryContextValue>(
        () => ({ tools, editors, tabRegistry: buildTabRegistry(tools, editors) }),
        [tools, editors],
    )
    return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>
}

function useRegistry(): RegistryContextValue {
    const ctx = useContext(RegistryContext)
    if (!ctx) {
        throw new Error('useRegistry must be used inside <RegistryProvider>')
    }
    return ctx
}

export function useTools(): readonly ToolDefinition[] {
    return useRegistry().tools
}

export function useEditors(): readonly AnyEditorDefinition[] {
    return useRegistry().editors
}

export function useTool(kind: string): ToolDefinition | undefined {
    return useRegistry().tools.find((t) => t.kind === kind)
}

export function useEditor(kind: string): AnyEditorDefinition | undefined {
    return useRegistry().editors.find((e) => e.kind === kind)
}

/** Resolve an editor by mime type. First match wins. Supports `<type>/*`
 *  wildcard patterns in `EditorDefinition.mimeTypes`. */
export function useEditorForMime(mimeType: string | undefined): AnyEditorDefinition | undefined {
    const editors = useRegistry().editors
    if (!mimeType) return undefined
    return editors.find((e) => e.mimeTypes.some((pattern) => matchesMime(pattern, mimeType)))
}

function matchesMime(pattern: string, mime: string): boolean {
    if (pattern === mime) return true
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1)
        return mime.startsWith(prefix)
    }
    return false
}

export function useTabRegistry(): TabRegistry {
    return useRegistry().tabRegistry
}
