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
// Tabs are typed by `kind` and refer to renderable content via the tab
// registry on the host. Tabs themselves do not carry React state.

export type TabKind = string

export type Tab = {
    id: string
    kind: TabKind
    /** Display title in the tab strip. */
    title: string
    /** Optional small metadata blob serialized with the layout (e.g. file path,
     *  doc id). Renderers receive it via `tab.payload`. */
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

export type WorkspaceState = {
    /** Top-level horizontal split sizes (left, middle, right) — sum to 100.
     *  Stored even when a dock is hidden so we restore the right size when
     *  it's brought back. */
    columnSizes: [number, number, number]
    /** Vertical split sizes inside the middle column (center, bottom). */
    middleSizes: [number, number]
    /** Visibility flags for the tool docks. Null state below means "empty"
     *  (no tabs); `visible=false` means user toggled it off via the button. */
    docksVisible: { left: boolean; right: boolean; bottom: boolean }
    left: ToolDockState
    right: ToolDockState
    bottom: ToolDockState
    center: EditorGroupNode
}

/** Drop zones recognized during a drag. Format:
 *    - `tool:<dockId>:<index>` — drop a tool tab into a tool dock at index
 *    - `editor:<leafId>:<index>` — drop an editor tab into a leaf at index
 *    - `split:<leafId>:<side>` — split a leaf by dropping at one of its edges
 */
export type DropTargetId =
    | `tool:${DockId}:${number}`
    | `editor:${string}:${number}`
    | `split:${string}:${'left' | 'right' | 'top' | 'bottom'}`

export type DragTabPayload = {
    tab: Tab
    source: { kind: 'tool'; dockId: DockId } | { kind: 'editor'; leafId: string }
}

export type TabRenderer = (tab: Tab) => React.ReactNode
