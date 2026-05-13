import { useCallback, useMemo } from 'react'

import { HCClient, HCClientProvider, useHCClient } from '@hollowcube/api'
import { TooltipProvider } from '@hollowcube/design-system'

import {
    makeId,
    resolveTargetLeaf,
    useWorkspaceStore,
    Workspace,
    type DockId,
    type Tab,
    type TabLocation,
} from '../workspace'
import { type WorkspaceStoreHook } from '../workspace/context'
import {
    ActionContextProvider,
    ActionHotkeyBridge,
    ActionRegistryProvider,
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
import { DocumentStoreProvider, useDocumentStore } from './documents'
import { apiTestEditor } from './editors/api-test'
import { TEXT_EDITOR_KIND, textEditor } from './editors/text'
import { welcomeEditor } from './editors/welcome'
import { createInitialWorkspaceState } from './initial-state'
import { ProjectTopBar } from './ProjectTopBar'
import { type AnyEditorDefinition, type ToolDefinition } from './registry'
import { RegistryProvider, useTabRegistry, useTools } from './registry-context'
import { filesTool } from './tools/files'

// The project id stays hardcoded until `/:projectId` routing lands. The
// storage key encodes it, so per-project layout state is naturally isolated.
const PROJECT_ID = 'demo'
const STORAGE_KEY = `hc-project:${PROJECT_ID}:workspace-v2`

const TOOLS: readonly ToolDefinition[] = [filesTool]
const EDITORS: readonly AnyEditorDefinition[] = [welcomeEditor, apiTestEditor, textEditor]

export function ProjectWorkspace() {
    // Single HCClient for the workspace. Both web and desktop proxy `/v1` to
    // the Go server in dev (see {web,desktop/frontend}/vite.config.ts).
    const client = useMemo(() => new HCClient({ baseUrl: '/v1' }), [])

    return (
        <HCClientProvider client={client}>
            <ProjectLoader
                projectId={PROJECT_ID}
                loading={<StatusScreen tone='muted'>Loading project…</StatusScreen>}
                errored={(err) => (
                    <StatusScreen tone='error'>
                        Failed to load project: {formatErr(err)}
                    </StatusScreen>
                )}
            >
                <RegistryProvider tools={TOOLS} editors={EDITORS}>
                    <DocumentStoreProvider>
                        <PendingFilesProvider>
                            <ProjectEventsProvider projectId={PROJECT_ID}>
                                <ActionRegistryProvider>
                                    <TooltipProvider>
                                        <ProjectGate>
                                            <ProjectWorkspaceInner />
                                        </ProjectGate>
                                    </TooltipProvider>
                                </ActionRegistryProvider>
                            </ProjectEventsProvider>
                        </PendingFilesProvider>
                    </DocumentStoreProvider>
                </RegistryProvider>
            </ProjectLoader>
        </HCClientProvider>
    )
}

function ProjectWorkspaceInner() {
    const client = useHCClient()
    const documentStore = useDocumentStore()
    const pendingStore = usePendingFilesStore()

    // Auto-save dirty saved-path editor tabs on close. Untitled dirty tabs
    // can't be saved without a path, so we allow them to close (discarding
    // the in-memory buffer) — the user always had Cmd+S available, which
    // surfaces the save prompt.
    const beforeCloseTab = useCallback(
        async (tab: Tab, _loc: TabLocation): Promise<boolean> => {
            if (tab.kind !== TEXT_EDITOR_KIND) return true
            const payload = tab.payload as { path?: string; tempId?: string } | undefined
            const explicitPath = payload?.path
            const pendingPath = payload?.tempId
                ? (pendingStore.getState().pending[payload.tempId]?.path ?? null)
                : null
            const effectivePath = explicitPath ?? pendingPath ?? null
            const docId =
                effectivePath ??
                (payload?.tempId ? `unsaved:${payload.tempId}` : `unsaved:${tab.id}`)
            const doc = documentStore.getState().documents[docId]
            if (!doc || !doc.dirty || !effectivePath) return true
            try {
                await client.v1.project.files.update(
                    PROJECT_ID,
                    effectivePath,
                    doc.current,
                    'text/plain',
                )
                documentStore.getState().commit(docId)
            } catch (e) {
                console.warn('[beforeCloseTab] auto-save failed', e)
            }
            return true
        },
        [client, documentStore, pendingStore],
    )

    const useStore = useWorkspaceStore({
        storageKey: STORAGE_KEY,
        initialState: createInitialWorkspaceState(),
        beforeCloseTab,
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
                <ActionHotkeyBridge />
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
            run: handler,
        }),
        [handler],
    )
    useRegisterAction(action)
    return null
}
