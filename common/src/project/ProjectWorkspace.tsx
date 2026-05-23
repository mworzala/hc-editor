import { useCallback, useMemo } from 'react'

import { HCClientProvider } from '@hollowcube/api'
import { TooltipProvider } from '@hollowcube/design-system'

import { useAuth } from '../auth'
import { LanguageProvider } from '../editor/languages'
import { EngineApiProvider } from '../engine-api'
import { LuauLspProvider } from '../lsp'
import { LspActions, LspUiOverlay, LspUiProvider } from '../lsp/ui'
import {
    makeId,
    resolveTargetLeaf,
    useWorkspaceStore,
    Workspace,
    type DockId,
} from '../workspace'
import { type WorkspaceStoreHook } from '../workspace/context'
import {
    ActionContextProvider,
    ActionHotkeyBridge,
    EditorActions,
    NativeMenuBridge,
    useProjectActions,
    useRegisterAction,
} from './actions'
import { ProjectGate } from './data'
import { ProjectEventsProvider } from './data/events'
import { ProjectLoader } from './data/loader'
import { PendingFilesProvider, usePendingFilesStore } from './data/pending-files'
import { CloseFocusedTabAction, useTabContextMenu } from './data/tab-actions'
import { DockAddToolButton } from './DockAddToolButton'
import { DockEmptyState } from './DockEmptyState'
import { DocumentStoreProvider } from './documents'
import { apiTestEditor } from './editors/api-test'
import { docsEditor } from './editors/docs'
import { TEXT_EDITOR_KIND, textEditor } from './editors/text'
import { welcomeEditor } from './editors/welcome'
import { ProjectErrorBoundary } from './error-boundary'
import { createInitialWorkspaceState } from './initial-state'
import { LspBufferBridge } from './LspBufferBridge'
import { LspWatchedFilesBridge } from './LspWatchedFilesBridge'
import { ProjectTopBar } from './ProjectTopBar'
import { type AnyEditorDefinition, type ToolDefinition } from './registry'
import { RegistryProvider, useTabRegistry, useTools } from './registry-context'
import { SearchActions, SearchPopup } from './search'
import { ProjectServicesProvider, ServicesActionRegistryAdapter } from './services-context'
import { filesTool } from './tools/files'
import { lspLogTool } from './tools/lsp-log'
import { problemsTool } from './tools/problems'
import { structureTool } from './tools/structure'

// The workspace storage key encodes the project id so per-project layout
// state is naturally isolated. Callers supply the id — web reads it from
// sessionStorage in its page shell, desktop reads it from the URL.
const workspaceStorageKey = (projectId: string) => `hc-project:${projectId}`

const TOOLS: readonly ToolDefinition[] = [filesTool, structureTool, problemsTool, lspLogTool]
const EDITORS: readonly AnyEditorDefinition[] = [
    welcomeEditor,
    apiTestEditor,
    textEditor,
    docsEditor,
]

export function ProjectWorkspace({ projectId }: { projectId: string }) {
    // The HCClient is owned by <AuthProvider> (constructed with the DPoP auth
    // hook). The `/v1` prefix is owned by the API client; baseUrl is just the
    // host root — empty on web (Vite proxies same-origin `/v1`), absolute on
    // desktop to bypass the `wails://` scheme handler (WebKit bug 192315).
    // This component assumes its caller has already passed an <AuthGate>.
    const { client } = useAuth()

    return (
        <ProjectErrorBoundary>
            <HCClientProvider client={client}>
                <ProjectLoader
                    projectId={projectId}
                    loading={<StatusScreen tone='muted'>Loading project…</StatusScreen>}
                    errored={(err) => (
                        <StatusScreen tone='error'>
                            Failed to load project: {formatErr(err)}
                        </StatusScreen>
                    )}
                >
                    <RegistryProvider tools={TOOLS} editors={EDITORS}>
                        <EngineApiProvider>
                            <LanguageProvider>
                                <DocumentStoreProvider>
                                    <PendingFilesProvider>
                                        <ProjectEventsProvider projectId={projectId}>
                                            <ProjectServicesProvider>
                                                <ServicesActionRegistryAdapter>
                                                    <TooltipProvider>
                                                        <ProjectGate>
                                                            <LuauLspProvider>
                                                                <LspUiProvider>
                                                                    <LspBufferBridge />
                                                                    <LspWatchedFilesBridge />
                                                                    <ProjectWorkspaceInner
                                                                        projectId={projectId}
                                                                    />
                                                                </LspUiProvider>
                                                            </LuauLspProvider>
                                                        </ProjectGate>
                                                    </TooltipProvider>
                                                </ServicesActionRegistryAdapter>
                                            </ProjectServicesProvider>
                                        </ProjectEventsProvider>
                                    </PendingFilesProvider>
                                </DocumentStoreProvider>
                            </LanguageProvider>
                        </EngineApiProvider>
                    </RegistryProvider>
                </ProjectLoader>
            </HCClientProvider>
        </ProjectErrorBoundary>
    )
}

function ProjectWorkspaceInner({ projectId }: { projectId: string }) {
    const useStore = useWorkspaceStore({
        storageKey: workspaceStorageKey(projectId),
        initialState: createInitialWorkspaceState(),
    })
    const tabRegistry = useTabRegistry()
    const tabContextMenu = useTabContextMenu({ useStore })

    const renderEmpty = useCallback((dockId: DockId) => <EmptyDockContent dockId={dockId} />, [])
    const renderToolDockAdd = useCallback((dockId: DockId) => <ToolDockAdd dockId={dockId} />, [])

    return (
        <ActionContextProvider useStore={useStore}>
            <div className='bg-background text-foreground flex h-svh w-full flex-col overflow-hidden'>
                <NewFileAction useStore={useStore} />
                <CloseFocusedTabAction useStore={useStore} />
                <EditorActions useStore={useStore} />
                <LspActions useStore={useStore} />
                <SearchActions />
                <ActionHotkeyBridge />
                <NativeMenuBridge />
                <ProjectTopBar useStore={useStore} />
                <div className='min-h-0 flex-1'>
                    <Workspace
                        useStore={useStore}
                        tabRegistry={tabRegistry}
                        renderEmpty={renderEmpty}
                        renderToolDockAdd={renderToolDockAdd}
                        onTabContextMenu={tabContextMenu.onTabContextMenu}
                    />
                </div>
                {tabContextMenu.node}
                <SearchPopup useStore={useStore} />
                <LspUiOverlay />
            </div>
        </ActionContextProvider>
    )
}

function EmptyDockContent({ dockId }: { dockId: DockId }) {
    const tools = useTools()
    const { openTool } = useProjectActions()
    const handleAdd = useCallback(
        (toolKind: string) => openTool(toolKind, { dock: dockId }),
        [openTool, dockId],
    )
    return <DockEmptyState tools={tools} onAddTool={handleAdd} />
}

function ToolDockAdd({ dockId }: { dockId: DockId }) {
    const tools = useTools()
    const { openTool } = useProjectActions()
    const handleAdd = useCallback(
        (toolKind: string) => openTool(toolKind, { dock: dockId }),
        [openTool, dockId],
    )
    return <DockAddToolButton tools={tools} onAddTool={handleAdd} />
}

function StatusScreen({ children, tone }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
    return (
        <div
            className={
                tone === 'error'
                    ? 'bg-background text-destructive flex h-svh w-full items-center justify-center p-6 text-sm'
                    : 'bg-background text-muted-foreground flex h-svh w-full items-center justify-center p-6 text-sm'
            }
        >
            {children}
        </div>
    )
}

function formatErr(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

// Registers Cmd/Ctrl+N → new untitled text file. Mounted as a sibling to
// `<Workspace>` (so `useWorkspaceContext` isn't available); we call the
// workspace store directly via the `useStore` prop and reach the focused leaf
// using the same selector that `useProjectActions` would.
function NewFileAction({ useStore }: { useStore: WorkspaceStoreHook }) {
    const pendingStore = usePendingFilesStore()

    const handler = useCallback(() => {
        const tempId = pendingStore.getState().addUntitled()
        const store = useStore.getState()
        const leaf = resolveTargetLeaf(store)
        store.addTab(
            { kind: 'editor', leafId: leaf.id },
            {
                id: makeId('tab'),
                kind: TEXT_EDITOR_KIND,
                title: 'Untitled',
                payload: { tempId },
            },
        )
    }, [pendingStore, useStore])

    const action = useMemo(
        () => ({
            id: 'editor.newFile',
            title: 'New Untitled File',
            keybinding: '$mod+n',
            contexts: ['global'],
            menu: { path: 'file' as const, group: 'new', order: 10 },
            run: handler,
        }),
        [handler],
    )
    useRegisterAction(action)
    return null
}
