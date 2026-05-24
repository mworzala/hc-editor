export { EditorApp, type EditorAppDeps, type OpenProjectOpts } from './EditorApp'
export { Project, type ProjectDeps } from './Project'
export { AuthService, useAuth, type AuthContextValue, type AuthServiceDeps } from './auth'

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

export {
    WorkspaceLayoutService,
    findFirstLeaf,
    findLeaf,
    makeId,
    resolveTargetLeaf,
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
    ActiveEditorRegistry,
    useActiveDocId,
    useActiveEditorEntry,
    useActiveEditorRegistry,
    type ActiveEditorEntry,
} from './active-editor'

export {
    FileTreeService,
    PendingFilesService,
    useFiles,
    useFileTree,
    useFileTreeService,
    usePendingFile,
    usePendingFiles,
    usePendingFilesService,
    type DeleteResult,
    type FileTreeServiceDeps,
    type PendingFile,
    type RenameResult,
} from './files'

export {
    ProjectBootstrap,
    ProjectGate,
    useBootstrapStatus,
    useProjectBootstrap,
    useProjectMetadata,
    type BootstrapStatus,
    type ProjectBootstrapDeps,
} from './bootstrap'

export {
    TextModelService,
    createTextModel,
    useAnyDirty,
    useTextModel,
    useTextModelContent,
    useTextModels,
    type DocumentId,
    type SaveError,
    type SaveResult,
    type TextModel,
    type TextModelInternal,
    type TextModelServiceDeps,
    type TextModelServiceEvent,
} from './text-models'

export {
    LanguageService,
    useLanguageById,
    useLanguageForMime,
    useLanguageForPath,
    useLanguageService,
    useLanguages,
} from './languages'

export {
    EngineApiService,
    useEngineApi,
    useEngineApiBundle,
    useEngineApiService,
    useEngineApiStatus,
    type EngineApiServiceDeps,
    type EngineApiState,
    type EngineApiStatus,
} from './engine-api'

export {
    SearchService,
    useSearchService,
    useSearchSources,
    type SearchSource,
} from './search'

export {
    LspService,
    useDiagnosticPaths,
    useDiagnosticsForUri,
    useLsp,
    useLspClient,
    useLspStatus,
    useLuauLsp,
    type LspServiceDeps,
    type LuauLspSnapshot,
} from './lsp'

export {
    ServerEventsConnection,
    useEvents,
    useProjectConnection,
    type ConnectionStatus,
    type EventsStreamFactory,
    type ProjectConnection,
    type ServerEventsConnectionDeps,
} from './events'
