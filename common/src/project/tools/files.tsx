import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilePlusIcon, FilesIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { useHCClient, useV1MapFilesDelete, type MapFile } from '@hollowcube/api'
import { FileTree, type FileTreeNode, Input, ScrollArea } from '@hollowcube/design-system'

import { listAllLanguageMimes, useLanguages } from '../../editor/languages'
import { useLuauLsp, useDiagnosticPaths } from '../../lsp'
import { findLeaf, selectTabLocations, useWorkspaceContext } from '../../workspace'
import { type WorkspaceStoreHook } from '../../workspace/context'
import { ActionContextMenu, useProjectActions } from '../actions'
import { type Action } from '../actions/types'
import { useProject } from '../context'
import { usePendingFiles, usePendingFilesStore } from '../data/pending-files'
import { useDocumentStore } from '../documents'
import { TEXT_EDITOR_KIND } from '../editors/text'
import { type ToolDefinition } from '../registry'
import { buildFileTree, isTextContentType } from './files-tree'

export const FILES_TOOL_KIND = 'tool:files'

// Files tool — lists project files from the API, lets the user click to open
// or right-click for create / delete actions. A purely in-tree "+ New file"
// button adds a file at the root. Tree updates come from the events stream
// invalidating the project query; no manual refetch.

type CtxMenuState =
    | { open: false }
    | {
          open: true
          x: number
          y: number
          // Null for the empty-tree / root context.
          node: FileTreeNode | null
      }

type NewFileTarget = { parent: string } | null

function FilesPane() {
    const project = useProject()
    const pending = usePendingFiles()
    const pendingStore = usePendingFilesStore()
    const { openEditor } = useProjectActions()
    const deleteMutation = useV1MapFilesDelete()
    const { useStore } = useWorkspaceContext()
    const languages = useLanguages()
    const languageMimes = useMemo(() => listAllLanguageMimes(languages), [languages])
    const { client: lspClient } = useLuauLsp()
    const errorPaths = useDiagnosticPaths(lspClient, 1)
    const hcClient = useHCClient()
    const documentStore = useDocumentStore()

    const filesByPath = useMemo(() => {
        const map = new Map<string, MapFile>()
        for (const f of project.files) map.set(f.path, f)
        return map
    }, [project.files])

    const [ctx, setCtx] = useState<CtxMenuState>({ open: false })
    const [newFile, setNewFile] = useState<NewFileTarget>(null)
    const [openError, setOpenError] = useState<string | null>(null)
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [renameTarget, setRenameTarget] = useState<string | null>(null)

    const handleCommitNew = useCallback(
        (name: string) => {
            const trimmed = name.trim()
            setNewFile(null)
            if (!trimmed) return
            const parent = newFile?.parent ?? ''
            const fullPath = parent ? `${parent}/${trimmed}` : trimmed
            const tempId = pendingStore.getState().addAtPath(fullPath)
            openEditor({
                kind: TEXT_EDITOR_KIND,
                payload: { tempId },
                identityKey: 'tempId',
                title: trimmed.split('/').pop() ?? trimmed,
            })
        },
        [newFile, openEditor, pendingStore],
    )

    const handleCancelNew = useCallback(() => setNewFile(null), [])

    // Rename / move share the same path-rewrite primitive. Rename keeps the
    // file inside its parent dir; move-into-folder relocates it under a new
    // parent. Both go through the same flow: read current content (dirty doc
    // if open, else GET), PUT to the new path, DELETE the old, repoint any
    // open tabs. The server has no atomic rename endpoint today.
    const moveFileToPath = useCallback(
        async (sourceId: string, newPath: string) => {
            // Pending files (not yet on the server): just update the path on
            // the pending entry and reroute any tab payloads.
            if (sourceId.startsWith('pending:')) {
                const tempId = sourceId.slice('pending:'.length)
                pendingStore.getState().assignPath(tempId, newPath)
                return
            }
            const oldPath = sourceId
            if (oldPath === newPath) return
            if (filesByPath.has(newPath)) {
                setOpenError(`${newPath}: already exists`)
                return
            }
            // Prefer the document store's in-memory current text (dirty edits
            // would be lost on GET). Falls back to the server when the file
            // isn't open in any tab.
            const docState = documentStore.getState().documents[oldPath]
            let body: string
            let contentType = 'text/plain'
            if (docState) {
                body = docState.current
            } else {
                try {
                    const bytes = await hcClient.v1.map.files.get(project.id, oldPath)
                    body = new TextDecoder('utf-8', { fatal: false }).decode(bytes.bytes)
                    contentType = bytes.contentType || 'text/plain'
                } catch (e) {
                    setOpenError(`${oldPath}: failed to read (${formatErr(e)})`)
                    return
                }
            }
            try {
                await hcClient.v1.map.files.update(project.id, newPath, body, contentType)
            } catch (e) {
                setOpenError(`${newPath}: write failed (${formatErr(e)})`)
                return
            }
            try {
                await hcClient.v1.map.files.delete(project.id, oldPath)
            } catch (e) {
                // The new path is already written; the old will be tidied by
                // the next refresh. Surface the error but don't roll back.
                console.warn('[files.move] delete old failed', e)
            }
            // Repoint any open tabs from oldPath to newPath. Document store
            // entries keyed by path also need to migrate so the open editor
            // stays attached after the path swap.
            const docs = documentStore.getState().documents
            if (docs[oldPath]) {
                documentStore.getState().openDocument(newPath, docs[oldPath].current)
                documentStore.getState().closeDocument(oldPath, { force: true })
            }
            const store = useStore.getState()
            const locations = selectTabLocations(store)
            for (const [tabId, loc] of locations) {
                if (!loc || loc.kind !== 'editor') continue
                const leaf = findLeaf(store.center, loc.leafId)
                const tab = leaf?.tabs.find((t) => t.id === tabId)
                if (!tab || tab.kind !== TEXT_EDITOR_KIND) continue
                const tabPath = (tab.payload as { path?: string } | undefined)?.path
                if (tabPath !== oldPath) continue
                store.updateTab(tabId, {
                    title: newPath.split('/').pop() ?? newPath,
                    payload: { ...tab.payload, path: newPath },
                })
            }
        },
        [documentStore, filesByPath, hcClient, pendingStore, project.id, useStore],
    )

    const handleCommitRename = useCallback(
        (sourceId: string, newName: string) => {
            const trimmed = newName.trim()
            setRenameTarget(null)
            if (!trimmed) return
            const parent = sourceId.startsWith('pending:')
                ? (pendingStore.getState().pending[sourceId.slice('pending:'.length)]?.path ?? '')
                : sourceId
            const parentDir = parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : ''
            const newPath = parentDir ? `${parentDir}/${trimmed}` : trimmed
            void moveFileToPath(sourceId, newPath)
        },
        [moveFileToPath, pendingStore],
    )

    const handleCancelRename = useCallback(() => setRenameTarget(null), [])

    const renameInitialName = useMemo(() => {
        if (!renameTarget) return ''
        const path = renameTarget.startsWith('pending:')
            ? (pendingStore.getState().pending[renameTarget.slice('pending:'.length)]?.path ?? '')
            : renameTarget
        return path.split('/').pop() ?? ''
    }, [renameTarget, pendingStore])

    const nodes = useMemo(() => {
        const newFileExtra = newFile
            ? {
                  parent: newFile.parent,
                  id: 'inline-new',
                  render: (depth: number) => (
                      <NewFileInput
                          depth={depth}
                          parent={newFile.parent}
                          onConfirm={handleCommitNew}
                          onCancel={handleCancelNew}
                      />
                  ),
              }
            : undefined
        const renameExtra = renameTarget
            ? {
                  id: renameTarget,
                  render: (depth: number) => (
                      <RenameFileInput
                          depth={depth}
                          initialValue={renameInitialName}
                          onConfirm={(name) => handleCommitRename(renameTarget, name)}
                          onCancel={handleCancelRename}
                      />
                  ),
              }
            : undefined
        return buildFileTree(project.files, pending, {
            newFile: newFileExtra,
            rename: renameExtra,
            errorPaths,
        })
    }, [
        project.files,
        pending,
        newFile,
        handleCommitNew,
        handleCancelNew,
        renameTarget,
        renameInitialName,
        handleCommitRename,
        handleCancelRename,
        errorPaths,
    ])

    // Dismiss the inline "cannot open binary" message after a moment.
    useEffect(() => {
        if (!openError) return
        const id = window.setTimeout(() => setOpenError(null), 2400)
        return () => window.clearTimeout(id)
    }, [openError])

    const openNode = useCallback(
        (id: string, node: FileTreeNode) => {
            if (node.type === 'placeholder') return
            setSelectedId(id)
            if (node.type !== 'file') return
            if (id.startsWith('pending:')) {
                const tempId = id.slice('pending:'.length)
                openEditor({
                    kind: TEXT_EDITOR_KIND,
                    payload: { tempId },
                    identityKey: 'tempId',
                    title: node.name,
                })
                return
            }
            const file = filesByPath.get(id)
            if (!file) return
            if (!isTextContentType(file.contentType, languageMimes)) {
                setOpenError(`${file.path}: cannot open ${file.contentType} files`)
                return
            }
            // Open by editor `kind` directly, not by mime — the text editor
            // self-describes as `text/*` and the language is resolved inside
            // the tab via the language registry against the file path.
            openEditor({
                kind: TEXT_EDITOR_KIND,
                payload: { path: file.path },
                identityKey: 'path',
                title: node.name,
            })
        },
        [filesByPath, openEditor, languageMimes],
    )

    const handleMoveNode = useCallback(
        (sourceId: string, targetFolderId: string) => {
            // Derive new path: <targetFolder>/<sourceBasename>. For root drops
            // the host passes targetFolderId === '' but the FileTree only
            // reports folder drops today.
            const basename = sourceIdBasename(sourceId, pendingStore)
            if (!basename) return
            const newPath = targetFolderId ? `${targetFolderId}/${basename}` : basename
            void moveFileToPath(sourceId, newPath)
        },
        [moveFileToPath, pendingStore],
    )

    const handleContext = useCallback((e: React.MouseEvent, node: FileTreeNode | null) => {
        e.preventDefault()
        setCtx({ open: true, x: e.clientX, y: e.clientY, node })
    }, [])

    const handleDelete = useCallback(
        (path: string) => {
            // Close any open editor tabs that reference this file (or any file
            // beneath it for a deleted folder) BEFORE issuing the delete. The
            // tab unmount cancels the editor's pending autosave timer, so we
            // don't race the delete with a save that would resurrect the file.
            closeTabsForPath(useStore, path)
            deleteMutation.mutate({ mapId: project.id, path })
        },
        [deleteMutation, project.id, useStore],
    )

    // Keyboard handler on the scroll container: Delete removes the selection,
    // F2 / Enter starts an inline rename. Ignored when focus is inside an
    // input (rename / new-file row) so the user's typing isn't hijacked.
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const target = e.target as HTMLElement
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
            if (!selectedId) return
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedId.startsWith('pending:')) return
                if (!filesByPath.has(selectedId)) return
                e.preventDefault()
                handleDelete(selectedId)
                setSelectedId(null)
                return
            }
            if (e.key === 'F2' || e.key === 'Enter') {
                if (!filesByPath.has(selectedId) && !selectedId.startsWith('pending:')) return
                e.preventDefault()
                setRenameTarget(selectedId)
            }
        },
        [filesByPath, handleDelete, selectedId],
    )

    // Single delegated context-menu handler — covers tree rows AND empty
    // space below the tree. The previous `e.target === e.currentTarget` check
    // on the ScrollArea never fired because ScrollArea's inner viewport sits
    // between the event target and the scroll root.
    const handleContainerContext = useCallback(
        (e: React.MouseEvent) => {
            const treeitem = (e.target as HTMLElement).closest('[role="treeitem"]')
            if (treeitem) {
                const button = treeitem.querySelector('button')
                const name = button?.textContent ?? ''
                const node = findNodeByName(nodes, name)
                if (node) {
                    handleContext(e, node)
                    return
                }
            }
            handleContext(e, null)
        },
        [nodes, handleContext],
    )

    return (
        <div className='flex h-full flex-col pt-1.5'>
            <ScrollArea className='min-h-0 flex-1'>
                {/* tabIndex makes the container focusable so the keydown handler
                    receives Delete / F2 when the user clicks a file row (which
                    moves focus to the row's button — its keydown bubbles here). */}
                <div
                    className='min-h-full px-1.5 pb-2'
                    tabIndex={-1}
                    onContextMenu={handleContainerContext}
                    onKeyDown={handleKeyDown}
                >
                    {nodes.length === 0 ? (
                        <div className='text-muted-foreground flex items-center justify-center p-6 text-center text-xs'>
                            No files yet. Use the + button or right-click to add one.
                        </div>
                    ) : (
                        <FileTree
                            nodes={nodes}
                            selectedId={selectedId}
                            onSelect={openNode}
                            onMoveNode={handleMoveNode}
                        />
                    )}
                </div>
            </ScrollArea>
            {openError ? (
                <div className='bg-muted/40 text-muted-foreground border-t border-border px-3 py-1.5 text-xs'>
                    {openError}
                </div>
            ) : null}
            {ctx.open ? (
                <ActionContextMenu
                    open={ctx.open}
                    onOpenChange={(open) => !open && setCtx({ open: false })}
                    x={ctx.x}
                    y={ctx.y}
                    actions={buildFilesContextActions(
                        ctx,
                        setNewFile,
                        handleDelete,
                        setRenameTarget,
                    )}
                    className='w-44'
                />
            ) : null}
        </div>
    )
}

/** Close every text editor tab whose path equals `target` or sits beneath it
 *  (folder delete). Closing happens before the server mutation so the editor
 *  unmounts and cancels its autosave timer ahead of the delete. */
function closeTabsForPath(useStore: WorkspaceStoreHook, target: string) {
    const store = useStore.getState()
    const locations = selectTabLocations(store)
    const matches: { tabId: string; loc: ReturnType<typeof locations.get> }[] = []
    for (const [tabId, loc] of locations) {
        if (!loc || loc.kind !== 'editor') continue
        const leaf = findLeaf(store.center, loc.leafId)
        const tab = leaf?.tabs.find((t) => t.id === tabId)
        if (!tab || tab.kind !== TEXT_EDITOR_KIND) continue
        const tabPath = (tab.payload as { path?: string } | undefined)?.path
        if (!tabPath) continue
        if (tabPath === target || tabPath.startsWith(`${target}/`)) {
            matches.push({ tabId, loc })
        }
    }
    for (const { tabId, loc } of matches) {
        if (loc) store.closeTab(loc, tabId)
    }
}

function buildFilesContextActions(
    ctx: Extract<CtxMenuState, { open: true }>,
    setNewFile: (target: NewFileTarget) => void,
    onDelete: (path: string) => void,
    onRename: (id: string) => void,
): Action[] {
    const actions: Action[] = []
    const parent = newFileParent(ctx)
    actions.push({
        id: 'files.newFile',
        title: 'New file…',
        group: 'files',
        icon: <FilePlusIcon />,
        run: () => setNewFile({ parent }),
    })
    if (ctx.node && ctx.node.type === 'file') {
        actions.push({
            id: 'files.rename',
            title: 'Rename…',
            group: 'files',
            icon: <PencilIcon />,
            run: () => onRename(ctx.node!.id),
        })
    }
    const deletePath = filePathFromCtx(ctx)
    if (deletePath) {
        actions.push({
            id: 'files.delete',
            title: 'Delete',
            group: 'files-destructive',
            icon: <Trash2Icon />,
            danger: true,
            run: () => onDelete(deletePath),
        })
    }
    return actions
}

function sourceIdBasename(
    id: string,
    pendingStore: ReturnType<typeof usePendingFilesStore>,
): string | null {
    if (id.startsWith('pending:')) {
        const tempId = id.slice('pending:'.length)
        const entry = pendingStore.getState().pending[tempId]
        const path = entry?.path
        if (!path) return null
        return path.split('/').pop() ?? null
    }
    return id.split('/').pop() ?? null
}

function formatErr(e: unknown): string {
    if (e instanceof Error) return e.message
    return String(e)
}

// Walk the tree and find the first node whose name matches; OK for now —
// names are usually unique at any nesting level, and we only use this as a
// best-effort lookup for the context menu.
function findNodeByName(nodes: FileTreeNode[], name: string): FileTreeNode | null {
    for (const node of nodes) {
        if (node.type === 'placeholder') continue
        if (node.name === name) return node
        if (node.type === 'folder') {
            const hit = findNodeByName(node.children, name)
            if (hit) return hit
        }
    }
    return null
}

function newFileParent(ctx: CtxMenuState): string {
    if (!ctx.open || !ctx.node) return ''
    if (ctx.node.type === 'folder') return ctx.node.id
    // File node: take its parent dir.
    const id = ctx.node.id
    const lastSlash = id.lastIndexOf('/')
    if (lastSlash === -1) return ''
    return id.slice(0, lastSlash)
}

function filePathFromCtx(ctx: CtxMenuState): string | null {
    if (!ctx.open || !ctx.node || ctx.node.type !== 'file') return null
    if (ctx.node.id.startsWith('pending:')) return null
    return ctx.node.id
}

function NewFileInput({
    depth,
    parent,
    onConfirm,
    onCancel,
}: {
    depth: number
    parent: string
    onConfirm: (name: string) => void
    onCancel: () => void
}) {
    const [value, setValue] = useState('')
    const inputRef = useRef<HTMLInputElement | null>(null)
    // When this input mounts after a context-menu "New file…" click, base-ui's
    // menu fires close-focus restoration right around the same time. That
    // steals focus from the input and produces a synthetic blur — if we cancel
    // on every blur, the input unmounts before the user even sees it (the
    // user's report: "Adding a new file does not work"). Ignore blurs inside a
    // short grace window after mount and re-focus the input; real user blurs
    // (clicking elsewhere) happen well after this window.
    const mountedAtRef = useRef(0)
    useEffect(() => {
        mountedAtRef.current = performance.now()
        inputRef.current?.focus()
    }, [])
    const handleBlur = () => {
        if (performance.now() - mountedAtRef.current < 200) {
            requestAnimationFrame(() => inputRef.current?.focus())
            return
        }
        onCancel()
    }
    // The placeholder row matches the file-tree's indent formula
    // (`depth * 14 + 6`) so the input visually aligns with sibling files.
    return (
        <div className='py-0.5' style={{ paddingLeft: `${depth * 14 + 6}px` }}>
            <Input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        onConfirm(value)
                    } else if (e.key === 'Escape') {
                        e.preventDefault()
                        onCancel()
                    }
                }}
                placeholder={parent ? 'file.txt' : 'file.txt or dir/file.txt'}
                className='h-6 text-xs'
            />
        </div>
    )
}

function RenameFileInput({
    depth,
    initialValue,
    onConfirm,
    onCancel,
}: {
    depth: number
    initialValue: string
    onConfirm: (name: string) => void
    onCancel: () => void
}) {
    const [value, setValue] = useState(initialValue)
    const inputRef = useRef<HTMLInputElement | null>(null)
    useEffect(() => {
        const el = inputRef.current
        if (!el) return
        el.focus()
        // Select the basename without the extension so quick renames don't
        // require an extra keystroke to clear the existing text.
        const dot = initialValue.lastIndexOf('.')
        const end = dot > 0 ? dot : initialValue.length
        el.setSelectionRange(0, end)
    }, [initialValue])
    return (
        <div className='py-0.5' style={{ paddingLeft: `${depth * 14 + 6}px` }}>
            <Input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => onCancel()}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        onConfirm(value)
                    } else if (e.key === 'Escape') {
                        e.preventDefault()
                        onCancel()
                    }
                }}
                className='h-6 text-xs'
            />
        </div>
    )
}

export const filesTool: ToolDefinition = {
    kind: FILES_TOOL_KIND,
    title: 'Files',
    icon: <FilesIcon />,
    defaultLocation: 'left',
    render: () => <FilesPane />,
}
