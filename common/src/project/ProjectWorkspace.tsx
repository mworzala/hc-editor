import { useCallback, useEffect, useMemo, useState } from 'react'

import { TooltipProvider } from '@hollowcube/design-system'

import { LspUiOverlay } from '../lsp/ui'
import { useApp, useProject, useSignal } from '../model'
import { ProjectGate } from '../model/bootstrap'
import { ProjectProvider as ModelProjectProvider } from '../model/foundation/react'
import { Workspace, type DockId } from '../workspace'
import { ActionHotkeyBridge, NativeMenuBridge, useProjectActions } from './actions'
import { useDoubleTapKey } from './actions/double-tap'
import { useTabContextMenu } from './data/tab-actions'
import { DialogOverlay } from './DialogOverlay'
import { DockAddToolButton } from './DockAddToolButton'
import { DockEmptyState } from './DockEmptyState'
import { EditorFocusBridge } from './EditorFocusBridge'
import { apiTestEditor } from './editors/api-test'
import { docsEditor } from './editors/docs'
import { textEditor } from './editors/text'
import { welcomeEditor } from './editors/welcome'
import { ProjectErrorBoundary } from './error-boundary'
import { createInitialWorkspaceState } from './initial-state'
import { NotificationsOverlay } from './NotificationsOverlay'
import { ProjectTopBar } from './ProjectTopBar'
import { type AnyEditorDefinition, type ToolDefinition } from './registry'
import { RegistryProvider, useTabRegistry, useTools } from './registry-context'
import { SearchPopup } from './search'
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
                        <TooltipProvider>
                            <EditorFocusBridge />
                            <ActionHotkeyBridge />
                            <NativeMenuBridge />
                            <ProjectWorkspaceInner />
                        </TooltipProvider>
                    </RegistryProvider>
                </ProjectGate>
            </ProjectModelBridge>
        </ProjectErrorBoundary>
    )
}

// Constructs the model-layer `Project` once via `app.openProject(...)` and
// exposes it through `<ProjectProvider>`. Page shells call us with the
// project id; everything below reads via `useProject()`.
//
// Three pieces work together to keep this dance correct under React 18
// strict mode:
//   1. A `useState` initializer opens the project synchronously so the
//      very first render has a live project to hand down.
//   2. The component reads the project from `app.currentProject` via
//      `useSignal` rather than from local state. Strict mode simulates an
//      unmount that disposes the project — without reading the signal,
//      local state would still reference the disposed instance and the
//      gate would never advance.
//   3. The effect both *opens* (when nothing's live for this projectId,
//      e.g. immediately after the strict-mode cleanup) and *closes* on
//      unmount. `app.openProject` is idempotent for the same id, so the
//      initializer + this effect cooperate without double-creating.
function ProjectModelBridge({
    projectId,
    children,
}: {
    projectId: string
    children: React.ReactNode
}) {
    const app = useApp()
    const initialLayout = useMemo(() => createInitialWorkspaceState(), [])
    const toolMetadata = useMemo(
        () =>
            TOOLS.map((t) => ({
                kind: t.kind,
                title: t.title,
                defaultLocation: t.defaultLocation,
            })),
        [],
    )
    const editorMetadata = useMemo(
        () =>
            EDITORS.map((e) => ({
                kind: e.kind,
                mimeTypes: e.mimeTypes,
                singleton: e.singleton,
                parsePayload: e.parsePayload,
                titleFor: e.titleFor,
            })),
        [],
    )

    // Open synchronously during render so the very first commit hands a
    // live project to the rest of the tree.
    useState(() => {
        app.openProject(projectId, {
            initialLayout,
            tools: toolMetadata,
            editors: editorMetadata,
        })
        return true
    })

    // Live project — survives strict-mode's dispose-then-reopen cycle
    // because the signal flips with each open/close. Local state would
    // pin the originally-opened instance and render it even after the
    // strict-mode cleanup tore it down.
    const project = useSignal(app.currentProject)

    useEffect(() => {
        // Re-open when nothing's live for this id — covers strict-mode's
        // simulated cleanup as well as a route change to a fresh
        // projectId. In production (no strict mode) the initializer's
        // open is still active and this branch is a no-op.
        const cur = app.currentProject.peek()
        if (!cur || cur.projectId !== projectId) {
            app.openProject(projectId, {
                initialLayout,
                tools: toolMetadata,
                editors: editorMetadata,
            })
        }
        return () => {
            const c = app.currentProject.peek()
            if (c && c.projectId === projectId) {
                app.closeProject()
            }
        }
    }, [app, projectId, initialLayout, toolMetadata, editorMetadata])

    if (!project || project.projectId !== projectId) return null
    return <ModelProjectProvider project={project}>{children}</ModelProjectProvider>
}

function ProjectWorkspaceInner() {
    const tabRegistry = useTabRegistry()
    const tabContextMenu = useTabContextMenu()
    const search = useProject().search

    const renderEmpty = useCallback((dockId: DockId) => <EmptyDockContent dockId={dockId} />, [])
    const renderToolDockAdd = useCallback((dockId: DockId) => <ToolDockAdd dockId={dockId} />, [])

    // Double-tap Shift opens the global search popup. It's a one-off gesture
    // that doesn't fit the action keybinding model, so we keep the hook here.
    useDoubleTapKey('Shift', () => search.openWith('all'), { windowMs: 350 })

    return (
        <div className='bg-background text-foreground flex h-svh w-full flex-col overflow-hidden'>
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
            <DialogOverlay />
            <NotificationsOverlay />
        </div>
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
