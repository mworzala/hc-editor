// Workspace state model.
//
// Two distinct kinds of "panes":
//
//  • ToolDock — a single column of tabs (file browser, terminal, properties).
//    Sits in LEFT / BOTTOM / RIGHT slots. Not splittable.
//
//  • EditorGroup — a recursive tree of tabbed panes that can be split
//    horizontally or vertically. Only used in the CENTER slot.
//
// Tabs are typed by `kind` and refer to renderable content via a TabRegistry
// supplied by the host. Tabs themselves do not carry React state.

import { type ReactNode } from 'react'

export type TabKind = string

export type Tab = {
    id: string
    kind: TabKind
    /** Display title in the tab strip. */
    title: string
    /** Optional small metadata blob serialized with the layout (e.g. file path,
     *  doc id). Renderers receive it via `tab.payload`.
     *
     *  Convention: payload is for *tab identity* (which file? which view of it?)
     *  — not document content. Use a separate document store for content. */
    payload?: Record<string, unknown>
}

export type ToolDockState = {
    tabs: Tab[]
    activeId: string | null
}

// Recursive editor group tree.
//   - `leaf` is a tabbed group of editors
//   - `split` divides its area in half along `orientation` between two children
export type EditorGroupNode =
    | { kind: 'leaf'; id: string; tabs: Tab[]; activeId: string | null }
    | {
          kind: 'split'
          id: string
          orientation: 'horizontal' | 'vertical'
          children: [EditorGroupNode, EditorGroupNode]
          sizes: [number, number] // sums to 100
      }

export type DockId = 'left' | 'right' | 'bottom'

/** Side of a leaf where an edge-drop will drop a tab to form a split. */
export type DragSide = 'left' | 'right' | 'top' | 'bottom'

/** Snapshot of the in-flight drag. Stored on the workspace store so other UI
 *  (debug overlays, future collaborative views) can react to it. */
export type ActiveDragState = {
    tab: Tab
    sourcePaneId: string
    sourceKind: 'tool' | 'editor'
    sourceLocator: { kind: 'tool'; dock: DockId } | { kind: 'editor'; leafId: string }
}

export type WorkspaceState = {
    /** Top-level horizontal split sizes (left, middle, right) — sum to 100.
     *  Stored even when a dock is hidden so we restore the right size when
     *  it's brought back. */
    columnSizes: [number, number, number]
    /** Vertical split sizes inside the middle column (center, bottom). */
    middleSizes: [number, number]
    /** Visibility flags for the tool docks. */
    docksVisible: { left: boolean; right: boolean; bottom: boolean }
    left: ToolDockState
    right: ToolDockState
    bottom: ToolDockState
    center: EditorGroupNode
    /** Which editor leaf last received user focus. Used as the default target
     *  for new editor tabs (command palette → open file, etc.). Set on tab
     *  activation, on click-into-pane, and on leaf creation via split. */
    focusedLeafId: string | null
}

/** Per-kind handlers the host supplies. `render` produces the tab's content;
 *  `icon` (optional) produces the small leading icon shown in the tab strip.
 *  `Tab` itself can't carry a ReactNode (it's persisted as JSON), so icons
 *  are resolved at render time from `kind` + `payload`. */
export type TabRegistryEntry = {
    render: (tab: Tab) => ReactNode
    icon?: (tab: Tab) => ReactNode
}

/** Map from `Tab.kind` to its handlers. The host supplies one entry per kind
 *  it cares about; unknown kinds fall through to a built-in placeholder. */
export type TabRegistry = Record<TabKind, TabRegistryEntry>
