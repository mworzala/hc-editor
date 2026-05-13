import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilePlusIcon, FilesIcon } from 'lucide-react'

import { useV1ProjectFilesDelete, type ProjectFile } from '@hollowcube/api'
import {
    Button,
    cn,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuPortal,
    FileTree,
    type FileTreeNode,
    Input,
    ScrollArea,
} from '@hollowcube/design-system'

import { useProjectActions } from '../actions'
import { useProject } from '../context'
import { usePendingFiles, usePendingFilesStore } from '../data/pending-files'
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
    const deleteMutation = useV1ProjectFilesDelete()

    const filesByPath = useMemo(() => {
        const map = new Map<string, ProjectFile>()
        for (const f of project.files) map.set(f.path, f)
        return map
    }, [project.files])

    const nodes = useMemo(() => buildFileTree(project.files, pending), [project.files, pending])

    const [ctx, setCtx] = useState<CtxMenuState>({ open: false })
    const [newFile, setNewFile] = useState<NewFileTarget>(null)
    const [openError, setOpenError] = useState<string | null>(null)

    // Dismiss the inline "cannot open binary" message after a moment.
    useEffect(() => {
        if (!openError) return
        const id = window.setTimeout(() => setOpenError(null), 2400)
        return () => window.clearTimeout(id)
    }, [openError])

    const openNode = useCallback(
        (id: string, node: FileTreeNode) => {
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
            if (!isTextContentType(file.contentType)) {
                setOpenError(`${file.path}: cannot open ${file.contentType} files`)
                return
            }
            openEditor({
                mimeType: file.contentType,
                payload: { path: file.path },
                identityKey: 'path',
                title: node.name,
            })
        },
        [filesByPath, openEditor],
    )

    const handleContext = useCallback((e: React.MouseEvent, node: FileTreeNode | null) => {
        e.preventDefault()
        setCtx({ open: true, x: e.clientX, y: e.clientY, node })
    }, [])

    const handleAddRoot = useCallback(() => setNewFile({ parent: '' }), [])
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

    const handleDelete = useCallback(
        (path: string) => {
            deleteMutation.mutate({ projectId: project.id, path })
        },
        [deleteMutation, project.id],
    )

    return (
        <div className='flex h-full flex-col'>
            <div className='flex items-center justify-between px-2 py-1.5'>
                <span className='text-muted-foreground text-xs font-medium uppercase tracking-wide'>
                    Files
                </span>
                <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='New file at root'
                    onClick={handleAddRoot}
                >
                    <FilePlusIcon />
                </Button>
            </div>
            <ScrollArea className='min-h-0 flex-1'>
                <div
                    className='px-1 pb-2'
                    onContextMenu={(e) => {
                        // Right-click on empty area => root context.
                        if (e.target === e.currentTarget) handleContext(e, null)
                    }}
                >
                    {nodes.length === 0 && !newFile ? (
                        <div className='text-muted-foreground flex items-center justify-center p-6 text-center text-xs'>
                            No files yet. Use the + button or right-click to add one.
                        </div>
                    ) : (
                        <TreeWithMenus
                            nodes={nodes}
                            onSelect={openNode}
                            onContext={handleContext}
                        />
                    )}
                    {newFile && newFile.parent === '' ? (
                        <NewFileInput
                            onConfirm={handleCommitNew}
                            onCancel={() => setNewFile(null)}
                        />
                    ) : null}
                </div>
            </ScrollArea>
            {openError ? (
                <div className='bg-muted/40 text-muted-foreground border-t border-border px-3 py-1.5 text-xs'>
                    {openError}
                </div>
            ) : null}
            <ContextMenu
                state={ctx}
                onOpenChange={(open) => !open && setCtx({ open: false })}
                onNewFile={() => {
                    const parent = newFileParent(ctx)
                    setNewFile({ parent })
                    setCtx({ open: false })
                }}
                onDelete={() => {
                    const path = filePathFromCtx(ctx)
                    setCtx({ open: false })
                    if (path) handleDelete(path)
                }}
            />
        </div>
    )
}

function TreeWithMenus({
    nodes,
    onSelect,
    onContext,
}: {
    nodes: FileTreeNode[]
    onSelect: (id: string, node: FileTreeNode) => void
    onContext: (e: React.MouseEvent, node: FileTreeNode) => void
}) {
    // The design-system FileTree doesn't have an onContextMenu prop, so we
    // wrap it in a div with a delegated handler. We use the data-slot attribute
    // baked into the tree row buttons to identify which node was clicked.
    return (
        <div
            onContextMenu={(e) => {
                const target = (e.target as HTMLElement).closest('[role="treeitem"]')
                if (!target) return
                const button = target.querySelector('button')
                if (!button) return
                const name = button.textContent ?? ''
                const node = findNodeByName(nodes, name)
                if (node) onContext(e, node)
            }}
        >
            <FileTree nodes={nodes} onSelect={onSelect} />
        </div>
    )
}

// Walk the tree and find the first node whose name matches; OK for now —
// names are usually unique at any nesting level, and we only use this as a
// best-effort lookup for the context menu.
function findNodeByName(nodes: FileTreeNode[], name: string): FileTreeNode | null {
    for (const node of nodes) {
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

function ContextMenu(props: {
    state: CtxMenuState
    onOpenChange: (open: boolean) => void
    onNewFile: () => void
    onDelete: () => void
}) {
    if (!props.state.open) return null
    return <ContextMenuInner {...props} state={props.state} />
}

function ContextMenuInner({
    state,
    onOpenChange,
    onNewFile,
    onDelete,
}: {
    state: Extract<CtxMenuState, { open: true }>
    onOpenChange: (open: boolean) => void
    onNewFile: () => void
    onDelete: () => void
}) {
    const isFile = state.node?.type === 'file'
    const isPendingFile = isFile && state.node!.id.startsWith('pending:')
    // VirtualElement form keeps the anchor coords pure data — base-ui calls
    // `getBoundingClientRect()` synchronously each frame, so the menu lines up
    // at the click point from the first paint (a real DOM element initialized
    // at (0,0) then moved in useEffect would briefly render top-left).
    const anchor = useMemo<MenuVirtualElement>(
        () => ({
            getBoundingClientRect: () =>
                ({
                    x: state.x,
                    y: state.y,
                    left: state.x,
                    top: state.y,
                    right: state.x,
                    bottom: state.y,
                    width: 0,
                    height: 0,
                    toJSON() {
                        return undefined
                    },
                }) as DOMRect,
        }),
        [state.x, state.y],
    )
    return (
        <DropdownMenu open onOpenChange={onOpenChange}>
            <DropdownMenuPortal>
                <DropdownMenuContent anchor={anchor} side='bottom' align='start' className='w-44'>
                    <DropdownMenuItem onClick={onNewFile}>New file…</DropdownMenuItem>
                    {isFile && !isPendingFile ? (
                        <DropdownMenuItem variant='destructive' onClick={onDelete}>
                            Delete
                        </DropdownMenuItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenuPortal>
        </DropdownMenu>
    )
}

type MenuVirtualElement = { getBoundingClientRect: () => DOMRect }

function NewFileInput({
    onConfirm,
    onCancel,
}: {
    onConfirm: (name: string) => void
    onCancel: () => void
}) {
    const [value, setValue] = useState('')
    const inputRef = useRef<HTMLInputElement | null>(null)
    useEffect(() => {
        inputRef.current?.focus()
    }, [])
    return (
        <div className={cn('px-1.5 py-1')}>
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
                placeholder='file.txt or dir/file.txt'
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
