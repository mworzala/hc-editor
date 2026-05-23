import { type ReactNode } from 'react'

import { useLayout } from '../model/workspace'
import { selectTabLocations, type DockId, type Tab, type TabRegistry } from '../workspace'
import { PaneErrorBoundary } from './error-boundary'

// Two registries sit above the workspace primitive's flat `TabRegistry`:
//
//  • ToolDefinition  — singleton, sits in a tool dock (files, search, …).
//                      Each tool maps to its own `kind`.
//
//  • EditorDefinition — multi-instance, keyed by mime type (json, luau, …).
//                       Multiple editor tabs can exist for the same file
//                       (e.g. when split).
//
// Both registries stay separately addressable via `RegistryProvider`
// (./registry-context). `buildTabRegistry` exists only as the adapter that
// hands a flat `Record<kind, render>` to the workspace primitive, which
// doesn't know about tools vs editors. Each render is wrapped in a
// PaneErrorBoundary so one crashing tab can't take the workspace down.

export type ToolDefinition = {
    /** Tab kind. Convention: `tool:<id>`. */
    kind: string
    title: string
    icon: ReactNode
    /** Which dock the tool opens in if launched without an existing location. */
    defaultLocation: DockId
    render: (tab: Tab) => ReactNode
}

/** Editor for tabs whose payload matches `TPayload`. Payload parsing is the
 *  registry's job, not each editor's: pass a `parsePayload` (typically a
 *  `z.parse` call) and the typed value is handed to `titleFor` and `render`.
 *  Editors that don't need a payload can leave `TPayload` as `void` and skip
 *  `parsePayload`. */
export type EditorDefinition<TPayload = unknown> = {
    /** Tab kind. Convention: `editor:<mime>` or `editor:<synthetic>`. */
    kind: string
    /** Mime types this editor handles. Empty for synthetic editors like Welcome. */
    mimeTypes: readonly string[]
    /** When true, this editor is a singleton: opening it again focuses the
     *  existing instance instead of creating a new tab. Welcome / API-test /
     *  Docs are singletons; the generic text editor is not. */
    singleton?: boolean
    /** Validate and narrow the tab's payload. Receives the raw `Tab.payload`
     *  blob from storage. If omitted, the raw value is passed through as-is. */
    parsePayload?: (raw: unknown) => TPayload
    /** Optional title resolver. Receives the parsed payload. */
    titleFor?: (payload: TPayload) => string
    /** Optional leading-icon resolver for the tab strip. Receives the parsed
     *  payload — typically used to pick a file-type icon from the file path. */
    iconFor?: (payload: TPayload) => ReactNode
    render: (ctx: { tab: Tab; payload: TPayload }) => ReactNode
}

/** Convenience alias for the "I don't care about payload type" use site
 *  (registry storage, command palette listings, etc.). */
export type AnyEditorDefinition = EditorDefinition<unknown>

/** Adapter for the underlying workspace primitive. Wraps every editor's render
 *  with payload parsing + an error boundary so the primitive can stay
 *  payload-agnostic and a single bad tab won't crash the rest of the app. */
export function buildTabRegistry(
    tools: readonly ToolDefinition[],
    editors: readonly AnyEditorDefinition[],
): TabRegistry {
    const registry: TabRegistry = {}
    for (const tool of tools) {
        registry[tool.kind] = {
            render: (tab) => <PaneTabWrapper tab={tab}>{tool.render(tab)}</PaneTabWrapper>,
            icon: () => tool.icon,
        }
    }
    for (const editor of editors) {
        const parse = editor.parsePayload
        const iconFor = editor.iconFor
        registry[editor.kind] = {
            render: (tab) => {
                const payload = parse ? parse(tab.payload) : tab.payload
                return <PaneTabWrapper tab={tab}>{editor.render({ tab, payload })}</PaneTabWrapper>
            },
            icon: iconFor
                ? (tab) => {
                      const payload = parse ? parse(tab.payload) : tab.payload
                      return iconFor(payload)
                  }
                : undefined,
        }
    }
    return registry
}

function PaneTabWrapper({ tab, children }: { tab: Tab; children: ReactNode }) {
    const layout = useLayout()
    const closeTab = () => {
        const loc = selectTabLocations(layout.state.peek()).get(tab.id)
        if (!loc) return
        layout.closeTab(loc, tab.id)
    }
    return (
        <PaneErrorBoundary resetKey={tab.id} onClose={closeTab}>
            {children}
        </PaneErrorBoundary>
    )
}
