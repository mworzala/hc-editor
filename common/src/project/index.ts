export { ProjectWorkspace } from './ProjectWorkspace'
export { synthesizeProjectName } from './display'
export {
    buildTabRegistry,
    type ToolDefinition,
    type EditorDefinition,
    type AnyEditorDefinition,
} from './registry'
export {
    RegistryProvider,
    useTabRegistry,
    useEditors,
    useEditor,
    useEditorForMime,
    useTools,
    useTool,
} from './registry-context'
export {
    ActionHotkeyBridge,
    ActionContextMenu,
    NativeMenuBridge,
    useProjectActions,
    useProjectActionsForLayout,
    type ContextMenuAction,
    type OpenEditorArgs,
    type OpenEditorTarget,
    type ProjectActions,
} from './actions'
export { AppErrorBoundary, ProjectErrorBoundary, PaneErrorBoundary } from './error-boundary'
