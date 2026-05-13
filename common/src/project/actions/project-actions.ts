import { useCallback } from 'react'

import {
    makeId,
    resolveTargetLeaf,
    selectTabLocations,
    useWorkspaceContext,
    type DockId,
    type Tab,
    type WorkspaceStore,
} from '../../workspace'
import { type WorkspaceStoreHook } from '../../workspace/context'
import { type AnyEditorDefinition, type ToolDefinition } from '../registry'
import { useEditors, useTools } from '../registry-context'

// Host-level actions that compose primitive store ops with project semantics
// (tool/editor registries, mime resolution, identity matching). The workspace
// primitive intentionally doesn't know about these concepts.

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
    /** Open an editor tab. Looks the editor up by `kind` or `mimeType`,
     *  reuses an existing tab if `identityKey` matches, otherwise creates one. */
    openEditor: (args: OpenEditorArgs) => void
    /** Open (or focus) a tool. Tools are singletons — if it already lives in
     *  any dock, it's focused; otherwise created at the tool's `defaultLocation`
     *  unless `dock` is overridden. */
    openTool: (toolKind: string, opts?: { dock?: DockId }) => void
}

/** Hook form: reads the workspace store + tools/editors from context. Must be
 *  used inside `<Workspace>`. */
export function useProjectActions(): ProjectActions {
    const { useStore } = useWorkspaceContext()
    return useProjectActionsForStore(useStore)
}

/** Hook variant for callers that hold the store hook directly (siblings of
 *  `<Workspace>`, e.g. the search popup). Tools/editors still come from the
 *  RegistryProvider, which sits outside of `<Workspace>`. */
export function useProjectActionsForStore(useStore: WorkspaceStoreHook): ProjectActions {
    const tools = useTools()
    const editors = useEditors()

    const openEditor = useCallback(
        (args: OpenEditorArgs) => {
            const store = useStore.getState()
            const editor = resolveEditor(editors, args)
            if (!editor) {
                console.warn('[openEditor] no editor for', args.kind ?? args.mimeType, '— skipping')
                return
            }

            if (args.identityKey && args.payload?.[args.identityKey] !== undefined) {
                const match = findTabByIdentity(store, editor.kind, args.identityKey, args.payload)
                if (match) {
                    store.activateTab({ kind: 'editor', leafId: match.leafId }, match.tabId)
                    return
                }
            }

            const target = args.target ?? { kind: 'focused' }
            const leafId = resolveOpenTargetLeaf(store, target)
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
            store.addTab({ kind: 'editor', leafId }, tab)
        },
        [useStore, editors],
    )

    const openTool = useCallback(
        (toolKind: string, opts?: { dock?: DockId }) => {
            const store = useStore.getState()
            const tool = tools.find((t) => t.kind === toolKind)
            if (!tool) {
                console.warn('[openTool] no tool with kind', toolKind)
                return
            }
            const targetDock = opts?.dock ?? tool.defaultLocation
            moveOrCreateTool(store, tool, targetDock)
        },
        [useStore, tools],
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

/** Exact match, or wildcard form `<type>/*` (e.g. `text/*` matches `text/plain`). */
function matchesMime(pattern: string, mime: string): boolean {
    if (pattern === mime) return true
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1)
        return mime.startsWith(prefix)
    }
    return false
}

function resolveOpenTargetLeaf(state: WorkspaceStore, target: OpenEditorTarget): string {
    if (target.kind === 'leaf' || target.kind === 'new-tab') {
        return target.leafId
    }
    return resolveTargetLeaf(state).id
}

function findTabByIdentity(
    state: WorkspaceStore,
    kind: string,
    identityKey: string,
    payload: Record<string, unknown>,
): { leafId: string; tabId: string } | null {
    const target = payload[identityKey]
    const locations = selectTabLocations(state)
    for (const [tabId, loc] of locations) {
        if (loc.kind !== 'editor') continue
        const leaf = findLeafWalk(state, loc.leafId)
        if (!leaf) continue
        const tab = leaf.tabs.find((t) => t.id === tabId)
        if (!tab || tab.kind !== kind) continue
        if (tab.payload?.[identityKey] === target) {
            return { leafId: loc.leafId, tabId }
        }
    }
    return null
}

function findLeafWalk(state: WorkspaceStore, leafId: string) {
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

function moveOrCreateTool(state: WorkspaceStore, tool: ToolDefinition, dockId: DockId) {
    for (const candidate of ['left', 'right', 'bottom'] as const) {
        const existing = state[candidate].tabs.find((t) => t.kind === tool.kind)
        if (!existing) continue
        if (candidate === dockId) {
            state.activateTab({ kind: 'tool', dock: dockId }, existing.id)
            return
        }
        state.moveTab(
            { kind: 'tool', dock: candidate },
            { kind: 'tool', dock: dockId },
            existing.id,
            state[dockId].tabs.length,
        )
        return
    }
    state.addTab(
        { kind: 'tool', dock: dockId },
        { id: makeId('tab'), kind: tool.kind, title: tool.title },
    )
}
