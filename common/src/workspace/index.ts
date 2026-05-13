import './workspace.css'

export { Workspace } from './Workspace'
export { useWorkspaceStore } from './use-workspace-store'
export {
    createWorkspaceStore,
    clearWorkspaceStorage,
    makeId,
    selectTabLocations,
    selectActiveContextTags,
    findLeaf,
    findFirstLeaf,
    resolveTargetLeaf,
    type WorkspaceStore,
    type TabLocation,
} from './store'
export { STORAGE_VERSION } from './migrations'
export type {
    ActiveDragState,
    DockId,
    DragSide,
    EditorGroupNode,
    Tab,
    TabKind,
    TabRegistry,
    ToolDockState,
    WorkspaceState,
} from './types'
export { TOGGLE_ANIM_MS, EDGE_ZONE_PCT, DEFAULT_SPLIT_BIAS } from './constants'
export { type DragData } from './drag-data'
export { useWorkspaceContext } from './context'
