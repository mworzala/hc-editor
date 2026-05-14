import * as React from 'react'
import { ChevronRightIcon } from 'lucide-react'

import { UnknownFileIcon } from '../icons'
import { cn } from '../utils'

export type FileTreeNode =
    | {
          type: 'file'
          name: string
          id: string
          icon?: React.ReactNode
          /** Render the name with a red wavy underline (e.g. file has errors). */
          danger?: boolean
      }
    | { type: 'folder'; name: string; id: string; children: FileTreeNode[]; defaultOpen?: boolean }
    /** Inline placeholder node — the host renders a free-form ReactNode at this
     *  position in the tree. Used for the "new file" inline input and inline
     *  rename. The node receives the current `depth` so callers can match the
     *  tree's indentation. `name` is used for sibling sorting only; the
     *  rendered content is fully controlled by `render`. */
    | {
          type: 'placeholder'
          id: string
          name?: string
          render: (depth: number) => React.ReactNode
      }

type FileTreeProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> & {
    nodes: FileTreeNode[]
    selectedId?: string | null
    onSelect?: (id: string, node: FileTreeNode) => void
    /** Optional drag-and-drop wiring. When provided, file rows become draggable
     *  and folder rows accept drops. Drop on the root via the host's container
     *  (the tree itself doesn't expose root drops — that's a host concern). */
    onMoveNode?: (sourceId: string, targetFolderId: string) => void
}

function FileTree({ nodes, selectedId, onSelect, onMoveNode, className, ...props }: FileTreeProps) {
    return (
        <div
            data-slot='file-tree'
            role='tree'
            className={cn('flex flex-col gap-0.5 select-none text-sm', className)}
            {...props}
        >
            {nodes.map((n) => (
                <Node
                    key={n.id}
                    node={n}
                    depth={0}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onMoveNode={onMoveNode}
                />
            ))}
        </div>
    )
}

type NodeCommon = {
    depth: number
    selectedId?: string | null
    onSelect?: (id: string, node: FileTreeNode) => void
    onMoveNode?: (sourceId: string, targetFolderId: string) => void
}

function Node({ node, ...rest }: { node: FileTreeNode } & NodeCommon) {
    if (node.type === 'placeholder') {
        return <div role='treeitem'>{node.render(rest.depth)}</div>
    }
    const selected = rest.selectedId === node.id
    return <FileOrFolderNode node={node} selected={selected} {...rest} />
}

const DRAG_MIME = 'application/x-hc-file-tree-id'

function FileOrFolderNode({
    node,
    depth,
    selected,
    selectedId,
    onSelect,
    onMoveNode,
}: { node: Extract<FileTreeNode, { type: 'file' | 'folder' }>; selected: boolean } & NodeCommon) {
    const isFolder = node.type === 'folder'
    const [open, setOpen] = React.useState(
        node.type === 'folder' ? (node.defaultOpen ?? true) : false,
    )
    const [dragOver, setDragOver] = React.useState(false)

    const handleClick = () => {
        if (node.type === 'folder') setOpen((o) => !o)
        onSelect?.(node.id, node)
    }

    const danger = node.type === 'file' && node.danger

    const draggable = !!onMoveNode && node.type === 'file' && !node.id.startsWith('pending:')

    const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
        if (!draggable) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(DRAG_MIME, node.id)
        // Also set text/plain so some browsers' drag previews show useful info.
        e.dataTransfer.setData('text/plain', node.id)
    }

    const isFolderDropTarget = !!onMoveNode && node.type === 'folder'
    const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
        if (!isFolderDropTarget) return
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!dragOver) setDragOver(true)
    }
    const handleDragLeave = () => {
        if (dragOver) setDragOver(false)
    }
    const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
        if (!isFolderDropTarget) return
        const sourceId = e.dataTransfer.getData(DRAG_MIME)
        setDragOver(false)
        if (!sourceId || sourceId === node.id) return
        e.preventDefault()
        e.stopPropagation()
        onMoveNode?.(sourceId, node.id)
    }

    return (
        <div role='treeitem' aria-expanded={isFolder ? open : undefined} aria-selected={selected}>
            <button
                type='button'
                onClick={handleClick}
                data-node-id={node.id}
                draggable={draggable}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                    'group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
                    'hover:bg-muted/60',
                    selected && 'bg-primary/15 text-foreground hover:bg-primary/20',
                    dragOver && 'ring-1 ring-primary/40 bg-primary/10',
                )}
                style={{ paddingLeft: `${depth * 14 + 6}px` }}
            >
                {node.type === 'folder' ? (
                    <ChevronRightIcon
                        className={cn(
                            'size-3.5 text-muted-foreground transition-transform duration-200 ease-out',
                            open && 'rotate-90',
                        )}
                    />
                ) : (
                    (node.icon ?? <UnknownFileIcon className='size-3.5' />)
                )}
                <span
                    className={cn(
                        'truncate',
                        danger &&
                            'decoration-destructive underline decoration-wavy decoration-1 underline-offset-2',
                    )}
                >
                    {node.name}
                </span>
            </button>
            {node.type === 'folder' ? (
                <div
                    className={cn(
                        'grid transition-[grid-template-rows] duration-200 ease-out',
                        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                    )}
                    aria-hidden={!open}
                >
                    {/* min-h-0 is critical — without it the inner content's
                        intrinsic min-content size forces the 0fr row open. */}
                    <div className='min-h-0 overflow-hidden'>
                        <div role='group' className='flex flex-col gap-0.5 pt-0.5'>
                            {node.children.map((c) => (
                                <Node
                                    key={c.id}
                                    node={c}
                                    depth={depth + 1}
                                    selectedId={selectedId}
                                    onSelect={onSelect}
                                    onMoveNode={onMoveNode}
                                />
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

export { FileTree }
