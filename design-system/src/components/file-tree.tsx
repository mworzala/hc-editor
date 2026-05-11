import { cn } from '@hollowcube/design-system/lib/utils'
import { ChevronRightIcon, FileIcon, FolderIcon, FolderOpenIcon } from 'lucide-react'
import * as React from 'react'

export type FileTreeNode =
    | { type: 'file'; name: string; id: string; icon?: React.ReactNode }
    | { type: 'folder'; name: string; id: string; children: FileTreeNode[]; defaultOpen?: boolean }

type FileTreeProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> & {
    nodes: FileTreeNode[]
    selectedId?: string | null
    onSelect?: (id: string, node: FileTreeNode) => void
}

function FileTree({ nodes, selectedId, onSelect, className, ...props }: FileTreeProps) {
    return (
        <div
            data-slot='file-tree'
            role='tree'
            className={cn('flex flex-col gap-0.5 select-none text-sm', className)}
            {...props}
        >
            {nodes.map((n) => (
                <Node key={n.id} node={n} depth={0} selectedId={selectedId} onSelect={onSelect} />
            ))}
        </div>
    )
}

function Node({
    node,
    depth,
    selectedId,
    onSelect,
}: {
    node: FileTreeNode
    depth: number
    selectedId?: string | null
    onSelect?: (id: string, node: FileTreeNode) => void
}) {
    const [open, setOpen] = React.useState(
        node.type === 'folder' ? (node.defaultOpen ?? true) : false,
    )
    const isFolder = node.type === 'folder'
    const selected = selectedId === node.id

    const handleClick = () => {
        if (isFolder) setOpen((o) => !o)
        onSelect?.(node.id, node)
    }

    return (
        <div role='treeitem' aria-expanded={isFolder ? open : undefined} aria-selected={selected}>
            <button
                type='button'
                onClick={handleClick}
                className={cn(
                    'group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
                    'hover:bg-muted/60',
                    selected && 'bg-primary/15 text-foreground hover:bg-primary/20',
                )}
                style={{ paddingLeft: `${depth * 14 + 6}px` }}
            >
                {isFolder ? (
                    <ChevronRightIcon
                        className={cn(
                            'size-3.5 text-muted-foreground transition-transform',
                            open && 'rotate-90',
                        )}
                    />
                ) : (
                    <span className='inline-block size-3.5' />
                )}
                {isFolder ? (
                    open ? (
                        <FolderOpenIcon className='size-3.5 text-amber-300' />
                    ) : (
                        <FolderIcon className='size-3.5 text-amber-300/80' />
                    )
                ) : (
                    (node.icon ?? <FileIcon className='size-3.5 text-muted-foreground' />)
                )}
                <span className='truncate'>{node.name}</span>
            </button>
            {isFolder && open ? (
                <div role='group' className='flex flex-col gap-0.5'>
                    {node.children.map((c) => (
                        <Node
                            key={c.id}
                            node={c}
                            depth={depth + 1}
                            selectedId={selectedId}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}

export { FileTree }
