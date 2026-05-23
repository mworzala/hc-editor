export { EditorApp, type EditorAppDeps, type OpenProjectOpts } from './EditorApp'
export { Project, type ProjectDeps } from './Project'
export {
    WorkspaceLayoutService,
    findFirstLeaf,
    findLeaf,
    makeId,
    resolveTargetLeaf,
    selectActiveContextTags,
    selectTabLocations,
    useActiveDrag,
    useCenter,
    useColumnSizes,
    useDocksVisible,
    useFocusedLeafId,
    useHoveredPaneId,
    useLayout,
    useLayoutState,
    useMiddleSizes,
    type TabLocation,
    type WorkspaceLayoutServiceDeps,
} from './workspace'

export {
    AppProvider,
    ProjectProvider,
    useApp,
    useProject,
    useSignal,
    Emitter,
    type Event,
    type ReadonlySignal,
    type Signal,
    batch,
    computed,
    effect,
    signal,
    untracked,
} from './foundation'

export {
    ActionRegistry,
    type Action,
    type ActionMenu,
    type ActionRegistryDeps,
    type ActionRunArgs,
    type ActionRunSource,
    type MenuPath,
    MENU_PATHS,
} from './actions'

export { ContextService } from './context'
