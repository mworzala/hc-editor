// `NavigationService` — owns the `workspace.openEditor` and
// `workspace.openTool` actions. Both used to live as React hook callbacks
// on the host; lifting them into the model means components dispatch
// through the same action registry as every other user-initiated command
// (palette, hotkey, native menu, tests).
//
// Construction takes the layout service and the host's tool / editor
// metadata. Render functions stay React-side — this service only needs
// what it takes to find an existing tab, build a title, and route a new
// one.

import type { Tab, WorkspaceState } from '../../workspace/types'
import type { ActionRegistry } from '../actions/ActionRegistry'
import { findLeaf, makeId, resolveTargetLeaf, selectTabLocations } from '../workspace/tree-helpers'
import type { WorkspaceLayoutService } from '../workspace/WorkspaceLayoutService'
import type {
    AnyEditorMetadata,
    OpenEditorArgs,
    OpenEditorTarget,
    OpenToolArgs,
    ToolMetadata,
} from './types'

export interface NavigationServiceDeps {
    actions: ActionRegistry
    layout: WorkspaceLayoutService
    tools: readonly ToolMetadata[]
    editors: readonly AnyEditorMetadata[]
}

export class NavigationService {
    private readonly _actionDisposers: Array<() => void> = []

    constructor(private readonly deps: NavigationServiceDeps) {
        this._registerActions()
    }

    /** Open (or focus) an editor tab. Singleton + identity-keyed editors
     *  reuse an existing tab when one matches; otherwise a new tab is
     *  created at the resolved target leaf. */
    openEditor(args: OpenEditorArgs): void {
        const { layout, editors } = this.deps
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
                layout.activateTab({ kind: 'editor', leafId: existing.leafId }, existing.tab.id)
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
    }

    /** Open (or focus) a tool tab. Tools are singletons: an existing
     *  instance in any dock is moved to the requested dock if needed,
     *  else activated in place. */
    openTool(args: OpenToolArgs): void {
        const { layout, tools } = this.deps
        const tool = tools.find((t) => t.kind === args.kind)
        if (!tool) {
            console.warn('[openTool] no tool with kind', args.kind)
            return
        }
        const targetDock = args.dock ?? tool.defaultLocation
        const state = layout.state.peek()
        for (const candidate of ['left', 'right', 'bottom'] as const) {
            const existing = state[candidate].tabs.find((t) => t.kind === tool.kind)
            if (!existing) continue
            if (candidate === targetDock) {
                layout.activateTab({ kind: 'tool', dock: targetDock }, existing.id)
                return
            }
            layout.moveTab(
                { kind: 'tool', dock: candidate },
                { kind: 'tool', dock: targetDock },
                existing.id,
                state[targetDock].tabs.length,
            )
            return
        }
        layout.addTab(
            { kind: 'tool', dock: targetDock },
            { id: makeId('tab'), kind: tool.kind, title: tool.title },
        )
    }

    dispose(): void {
        for (const d of this._actionDisposers) d()
        this._actionDisposers.length = 0
    }

    private _registerActions(): void {
        const { actions } = this.deps
        this._actionDisposers.push(
            actions.register<OpenEditorArgs>({
                id: 'workspace.openEditor',
                title: 'Open Editor',
                run: (args) => {
                    this.openEditor(args ?? {})
                },
            }),
            actions.register<OpenToolArgs>({
                id: 'workspace.openTool',
                title: 'Open Tool',
                run: (args) => {
                    if (!args || !args.kind) return
                    this.openTool(args)
                },
            }),
        )
    }
}

// ---- helpers ----

function resolveEditor(
    editors: readonly AnyEditorMetadata[],
    args: OpenEditorArgs,
): AnyEditorMetadata | undefined {
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
        const leaf = findLeaf(state.center, loc.leafId)
        const tab = leaf?.tabs.find((t: Tab) => t.id === tabId)
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
        const leaf = findLeaf(state.center, loc.leafId)
        if (!leaf) continue
        const tab = leaf.tabs.find((t: Tab) => t.id === tabId)
        if (!tab || tab.kind !== kind) continue
        if (tab.payload?.[identityKey] === target) {
            return { leafId: loc.leafId, tab }
        }
    }
    return null
}
