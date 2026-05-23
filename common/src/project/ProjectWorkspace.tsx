import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { TooltipProvider } from '@hollowcube/design-system'

import { LspActions, LspUiOverlay, LspUiProvider } from '../lsp/ui'
import { useApp } from '../model'
import { ProjectGate } from '../model/bootstrap'
import { usePendingFilesService } from '../model/files'
import { ProjectProvider as ModelProjectProvider } from '../model/foundation/react'
import { useLayout } from '../model/workspace'
import { makeId, resolveTargetLeaf, Workspace, type DockId } from '../workspace'
import {
    ActionContextProvider,
    ActionHotkeyBridge,
    EditorActions,
    NativeMenuBridge,
    useProjectActions,
    useRegisterAction,
} from './actions'
import { CloseFocusedTabAction, useTabContextMenu } from './data/tab-actions'
import { DockAddToolButton } from './DockAddToolButton'
import { DockEmptyState } from './DockEmptyState'
import { apiTestEditor } from './editors/api-test'
import { docsEditor } from './editors/docs'
import { TEXT_EDITOR_KIND, textEditor } from './editors/text'
import { welcomeEditor } from './editors/welcome'
import { ProjectErrorBoundary } from './error-boundary'
import { createInitialWorkspaceState } from './initial-state'
import { LspBufferBridge } from './LspBufferBridge'
import { ProjectTopBar } from './ProjectTopBar'
import { type AnyEditorDefinition, type ToolDefinition } from './registry'
import { RegistryProvider, useTabRegistry, useTools } from './registry-context'
import { SearchActions, SearchPopup } from './search'
import { ProjectServicesProvider, ServicesActionRegistryAdapter } from './services-context'
import { filesTool } from './tools/files'
import { lspLogTool } from './tools/lsp-log'
import { problemsTool } from './tools/problems'
import { structureTool } from './tools/structure'

const TOOLS: readonly ToolDefinition[] = [filesTool, structureTool, problemsTool, lspLogTool]
const EDITORS: readonly AnyEditorDefinition[] = [
    welcomeEditor,
    apiTestEditor,
    textEditor,
    docsEditor,
]

export function ProjectWorkspace({ projectId }: { projectId: string }) {
    return (
        <ProjectErrorBoundary>
            <ProjectModelBridge projectId={projectId}>
                <ProjectGate
                    loading={<StatusScreen tone='muted'>Loading project…</StatusScreen>}
                    errored={(err) => (
                        <StatusScreen tone='error'>
                            Failed to load project: {formatErr(err)}
                        </StatusScreen>
                    )}
                >
                    <RegistryProvider tools={TOOLS} editors={EDITORS}>
                        <ProjectServicesProvider>
                            <ServicesActionRegistryAdapter>
                                <TooltipProvider>
                                    <LspUiProvider>
                                        <LspBufferBridge />
                                        <ProjectWorkspaceInner />
                                    </LspUiProvider>
                                </TooltipProvider>
                            </ServicesActionRegistryAdapter>
                        </ProjectServicesProvider>
                    </RegistryProvider>
                </ProjectGate>
            </ProjectModelBridge>
        </ProjectErrorBoundary>
    )
}

// Phase 2 bridge: constructs the model-layer `Project` once via
// `app.openProject(projectId, ...)` and exposes it through
// `<ProjectProvider>` so workspace consumers can reach
// `useProject().layout` / `.fileTree` / `.textModels` / `.lsp` / etc.
// Phase 6 will collapse this into the page shell.
function ProjectModelBridge({
    projectId,
    children,
}: {
    projectId: string
    children: React.ReactNode
}) {
    const app = useApp()
    const initialLayout = useMemo(() => createInitialWorkspaceState(), [])
    const projectRef = useRef<ReturnType<typeof app.openProject> | null>(null)
    const [, forceRender] = useState(0)

    useEffect(() => {
        const project = app.openProject(projectId, { initialLayout })
        projectRef.current = project
        forceRender((n) => n + 1)
        return () => {
            if (app.currentProject.peek() === project) {
                app.closeProject()
            }
            if (projectRef.current === project) projectRef.current = null
        }
    }, [app, projectId, initialLayout])

    const project = projectRef.current
    if (!project) return null
    return <ModelProjectProvider project={project}>{children}</ModelProjectProvider>
}

function ProjectWorkspaceInner() {
    const tabRegistry = useTabRegistry()
    const tabContextMenu = useTabContextMenu()

    const renderEmpty = useCallback((dockId: DockId) => <EmptyDockContent dockId={dockId} />, [])
    const renderToolDockAdd = useCallback((dockId: DockId) => <ToolDockAdd dockId={dockId} />, [])

    return (
        <ActionContextProvider>
            <div className='bg-background text-foreground flex h-svh w-full flex-col overflow-hidden'>
                <NewFileAction />
                <CloseFocusedTabAction />
                <EditorActions />
                <LspActions />
                <SearchActions />
                <ActionHotkeyBridge />
                <NativeMenuBridge />
                <ProjectTopBar />
                <div className='min-h-0 flex-1'>
                    <Workspace
                        tabRegistry={tabRegistry}
                        renderEmpty={renderEmpty}
                        renderToolDockAdd={renderToolDockAdd}
                        onTabContextMenu={tabContextMenu.onTabContextMenu}
                    />
                </div>
                {tabContextMenu.node}
                <SearchPopup />
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

// Registers Cmd/Ctrl+N → new untitled text file. Reads the focused leaf
// from `Project.layout` directly so it works for siblings of `<Workspace>`.
function NewFileAction() {
    const pendingSvc = usePendingFilesService()
    const layout = useLayout()

    const handler = useCallback(() => {
        const tempId = pendingSvc.addUntitled()
        const leaf = resolveTargetLeaf(layout.state.peek())
        layout.addTab(
            { kind: 'editor', leafId: leaf.id },
            {
                id: makeId('tab'),
                kind: TEXT_EDITOR_KIND,
                title: 'Untitled',
                payload: { tempId },
            },
        )
    }, [pendingSvc, layout])

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
