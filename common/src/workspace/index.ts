import './workspace.css'

export { Workspace } from './Workspace'
export { useWorkspaceContext } from './context'
export { STORAGE_VERSION } from './migrations'
export type {
    ActiveDragState,
    DockId,
    DragSide,
    EditorGroupNode,
    Tab,
    TabKind,
    TabRegistry,
    TabRegistryEntry,
    ToolDockState,
    WorkspaceState,
} from './types'
export { TOGGLE_ANIM_MS, EDGE_ZONE_PCT, DEFAULT_SPLIT_BIAS } from './constants'
export { type DragData } from './drag-data'

// State / mutations live on `Project.layout` (a `WorkspaceLayoutService`)
// and are reached via `useLayout()` from `@hollowcube/common/model`.
// `selectTabLocations`, `findLeaf`, `makeId`, etc. are re-exported from
// the model layer for convenience.
export {
    WorkspaceLayoutService,
    findFirstLeaf,
    findLeaf,
    makeId,
    resolveTargetLeaf,
    selectTabLocations,
    type TabLocation,
} from '../model/workspace'
