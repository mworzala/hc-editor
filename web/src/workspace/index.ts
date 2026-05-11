import './workspace.css'

export { Workspace } from './Workspace'
export {
    createWorkspaceStore,
    clearWorkspaceStorage,
    makeId,
    type WorkspaceStore,
    type TabLocation,
} from './store'
export type {
    DockId,
    EditorGroupNode,
    Tab,
    TabKind,
    TabRenderer,
    ToolDockState,
    WorkspaceState,
} from './types'
