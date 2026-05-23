import { useCallback } from 'react'

import { useLayout, type WorkspaceLayoutService } from '../../model/workspace'
import {
    makeId,
    resolveTargetLeaf,
    selectTabLocations,
    type DockId,
    type Tab,
    type WorkspaceState,
} from '../../workspace'
import { type AnyEditorDefinition, type ToolDefinition } from '../registry'
import { useEditors, useTools } from '../registry-context'

// Host-level actions that compose primitive layout ops with project
// semantics (tool/editor registries, mime resolution, identity matching).
// The workspace primitive intentionally doesn't know about these concepts.

export type OpenEditorTarget =
    | { kind: 'focused' } // current focused leaf, fall back to first
    | { kind: 'leaf'; leafId: string }
    | { kind: 'new-tab'; leafId: string }

export type OpenEditorArgs = {
    /** Either the editor kind directly, or a mime type to look up. */
    kind?: string
    mimeType?: string
    payload?: Record<string, unknown>
    /** Optional identity for reuse. If a tab with the same kind and matching
     *  `payload[identityKey]` already exists, it's activated instead of
     *  creating a new tab. Most file editors will pass `identityKey: 'path'`. */
    identityKey?: string
    title?: string
    target?: OpenEditorTarget
}

export type ProjectActions = {
    openEditor: (args: OpenEditorArgs) => void
    openTool: (toolKind: string, opts?: { dock?: DockId }) => void
}

/** Hook form: reads `Project.layout` from context. Must be used inside a
 *  `<ProjectProvider>`. */
export function useProjectActions(): ProjectActions {
    const layout = useLayout()
    return useProjectActionsForLayout(layout)
}

/** Hook variant for callers that hold the layout service directly. Tools
 *  and editors still come from the RegistryProvider. */
export function useProjectActionsForLayout(layout: WorkspaceLayoutService): ProjectActions {
    const tools = useTools()
    const editors = useEditors()

    const openEditor = useCallback(
        (args: OpenEditorArgs) => {
            const state = layout.state.peek()
            const editor = resolveEditor(editors, args)
            if (!editor) {
                console.warn('[openEditor] no editor for', args.kind ?? args.mimeType, '— skipping')
                return
            }

            if (editor.singleton) {
                const existing = findFirstTabOfKind(state, editor.kind)
                if (existing) {
                    if (args.payload) {
                        const merged = { ...existing.tab.payload, ...args.payload }
                        layout.updateTab(existing.tab.id, { payload: merged })
                    }
                    layout.activateTab(
                        { kind: 'editor', leafId: existing.leafId },
                        existing.tab.id,
                    )
                    return
                }
            }

            if (args.identityKey && args.payload?.[args.identityKey] !== undefined) {
                const match = findTabByIdentity(state, editor.kind, args.identityKey, args.payload)
                if (match) {
                    if (args.payload) {
                        const merged = { ...match.tab.payload, ...args.payload }
                        layout.updateTab(match.tab.id, { payload: merged })
                    }
                    layout.activateTab({ kind: 'editor', leafId: match.leafId }, match.tab.id)
                    return
                }
            }

            const target = args.target ?? { kind: 'focused' }
            const leafId = resolveOpenTargetLeaf(state, target)
            const payloadForTitle = editor.parsePayload
                ? editor.parsePayload(args.payload)
                : args.payload
            const title = args.title ?? editor.titleFor?.(payloadForTitle) ?? editor.kind

            const tab: Tab = {
                id: makeId('tab'),
                kind: editor.kind,
                title,
                payload: args.payload,
            }
            layout.addTab({ kind: 'editor', leafId }, tab)
        },
        [layout, editors],
    )

    const openTool = useCallback(
        (toolKind: string, opts?: { dock?: DockId }) => {
            const tool = tools.find((t) => t.kind === toolKind)
            if (!tool) {
                console.warn('[openTool] no tool with kind', toolKind)
                return
            }
            const targetDock = opts?.dock ?? tool.defaultLocation
            moveOrCreateTool(layout, targetDock, tool)
        },
        [layout, tools],
    )

    return { openEditor, openTool }
}

// --- helpers ---

function resolveEditor(
    editors: readonly AnyEditorDefinition[],
    args: OpenEditorArgs,
): AnyEditorDefinition | undefined {
    if (args.kind) return editors.find((e) => e.kind === args.kind)
    if (args.mimeType) {
        const mime = args.mimeType
        return editors.find((e) => e.mimeTypes.some((pattern) => matchesMime(pattern, mime)))
    }
    return undefined
}

function matchesMime(pattern: string, mime: string): boolean {
    if (pattern === mime) return true
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1)
        return mime.startsWith(prefix)
    }
    return false
}

function resolveOpenTargetLeaf(state: WorkspaceState, target: OpenEditorTarget): string {
    if (target.kind === 'leaf' || target.kind === 'new-tab') {
        return target.leafId
    }
    return resolveTargetLeaf(state).id
}

function findFirstTabOfKind(
    state: WorkspaceState,
    kind: string,
): { leafId: string; tab: Tab } | null {
    const locations = selectTabLocations(state)
    for (const [tabId, loc] of locations) {
        if (loc.kind !== 'editor') continue
        const leaf = findLeafWalk(state, loc.leafId)
        const tab = leaf?.tabs.find((t) => t.id === tabId)
        if (tab && tab.kind === kind) {
            return { leafId: loc.leafId, tab }
        }
    }
    return null
}

function findTabByIdentity(
    state: WorkspaceState,
    kind: string,
    identityKey: string,
    payload: Record<string, unknown>,
): { leafId: string; tab: Tab } | null {
    const target = payload[identityKey]
    const locations = selectTabLocations(state)
    for (const [tabId, loc] of locations) {
        if (loc.kind !== 'editor') continue
        const leaf = findLeafWalk(state, loc.leafId)
        if (!leaf) continue
        const tab = leaf.tabs.find((t) => t.id === tabId)
        if (!tab || tab.kind !== kind) continue
        if (tab.payload?.[identityKey] === target) {
            return { leafId: loc.leafId, tab }
        }
    }
    return null
}

function findLeafWalk(state: WorkspaceState, leafId: string) {
    if (state.center.kind === 'leaf') {
        return state.center.id === leafId ? state.center : null
    }
    const stack = [state.center.children[0], state.center.children[1]]
    while (stack.length > 0) {
        const node = stack.pop()!
        if (node.kind === 'leaf') {
            if (node.id === leafId) return node
        } else {
            stack.push(node.children[0], node.children[1])
        }
    }
    return null
}

function moveOrCreateTool(layout: WorkspaceLayoutService, dockId: DockId, tool: ToolDefinition) {
    const state = layout.state.peek()
    for (const candidate of ['left', 'right', 'bottom'] as const) {
        const existing = state[candidate].tabs.find((t) => t.kind === tool.kind)
        if (!existing) continue
        if (candidate === dockId) {
            layout.activateTab({ kind: 'tool', dock: dockId }, existing.id)
            return
        }
        layout.moveTab(
            { kind: 'tool', dock: candidate },
            { kind: 'tool', dock: dockId },
            existing.id,
            state[dockId].tabs.length,
        )
        return
    }
    layout.addTab(
        { kind: 'tool', dock: dockId },
        { id: makeId('tab'), kind: tool.kind, title: tool.title },
    )
}
