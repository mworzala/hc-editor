import { type ProjectFile } from '@hollowcube/api'
import { type FileTreeNode } from '@hollowcube/design-system'

import { type PendingFile } from '../data/pending-files'
import { renderFileIcon } from '../file-icons'

// Build a hierarchical FileTreeNode list from a flat ProjectFile array, with
// optional pending entries merged in. Pending entries with a path appear like
// real files; pending entries without a path (purely untitled) are ignored
// here — they live only as tabs, not as tree rows.
//
// Node ids:
//
//   • Saved files use the full path as id (so click handlers can pass the id
//     straight into `openEditor({ payload: { path: id } })`).
//   • Folder ids are the folder's full path (e.g. `src/utils`).
//   • Pending file ids use `pending:<tempId>` so the click handler can
//     distinguish them and route via the pending store.
//
// Sorting: folders first, then files; both alphabetical within their group.

type BuilderEntry =
    | { kind: 'file'; segments: string[]; id: string; contentType?: string; pending?: boolean }
    | never

export type BuildFileTreeExtras = {
    /** Paths (project-relative, no leading slash) that should render with the
     *  "danger" decoration (red underline). Used to surface LSP error
     *  diagnostics in the file browser. */
    errorPaths?: ReadonlySet<string>
    /** When set, inject an inline placeholder row at the end of this folder's
     *  children. `parent === ''` places it at the root. The host supplies
     *  `render(depth)` so the row matches the surrounding indentation. */
    newFile?: {
        parent: string
        id: string
        render: (depth: number) => React.ReactNode
    }
    /** When set, replace a file node with the rename row. Keyed by file id
     *  (the full path for saved files, `pending:<tempId>` for pending). */
    rename?: {
        id: string
        render: (depth: number) => React.ReactNode
    }
}

export function buildFileTree(
    files: readonly ProjectFile[],
    pending: readonly PendingFile[] = [],
    extras: BuildFileTreeExtras = {},
): FileTreeNode[] {
    const entries: BuilderEntry[] = []
    for (const f of files) {
        const segments = splitPath(f.path)
        if (segments.length === 0) continue
        entries.push({ kind: 'file', segments, id: f.path, contentType: f.contentType })
    }
    for (const p of pending) {
        if (!p.path) continue
        const segments = splitPath(p.path)
        if (segments.length === 0) continue
        entries.push({ kind: 'file', segments, id: `pending:${p.tempId}`, pending: true })
    }

    return assemble(entries, '', extras)
}

function assemble(
    entries: BuilderEntry[],
    folderPath: string,
    extras: BuildFileTreeExtras,
): FileTreeNode[] {
    const folderMap = new Map<string, BuilderEntry[]>()
    const files: FileTreeNode[] = []

    for (const entry of entries) {
        const [head, ...rest] = entry.segments
        if (!head) continue
        if (rest.length === 0) {
            if (extras.rename && extras.rename.id === entry.id) {
                const renamerNode = extras.rename
                files.push({
                    type: 'placeholder',
                    id: `rename:${entry.id}`,
                    name: head,
                    render: renamerNode.render,
                })
            } else {
                files.push({
                    type: 'file',
                    id: entry.id,
                    name: head,
                    icon: renderFileIcon(head),
                    danger: extras.errorPaths?.has(entry.id) ?? false,
                })
            }
            continue
        }
        const list = folderMap.get(head) ?? []
        list.push({ ...entry, segments: rest })
        folderMap.set(head, list)
    }

    const folders: FileTreeNode[] = []
    for (const [name, childEntries] of folderMap) {
        const childPath = folderPath ? `${folderPath}/${name}` : name
        folders.push({
            type: 'folder',
            id: childPath,
            name,
            children: assemble(childEntries, childPath, extras),
            defaultOpen: true,
        })
    }

    folders.sort(byName)
    files.sort(byNodeName)

    const out: FileTreeNode[] = [...folders, ...files]
    if (extras.newFile && extras.newFile.parent === folderPath) {
        const placeholder = extras.newFile
        out.push({
            type: 'placeholder',
            id: `new-file:${placeholder.id}`,
            render: placeholder.render,
        })
    }
    return out
}

function byName(a: FileTreeNode, b: FileTreeNode): number {
    const an = nodeName(a)
    const bn = nodeName(b)
    return an.localeCompare(bn)
}

function byNodeName(a: FileTreeNode, b: FileTreeNode): number {
    return byName(a, b)
}

function nodeName(n: FileTreeNode): string {
    if (n.type === 'placeholder') return n.name ?? n.id
    return n.name
}

function splitPath(path: string): string[] {
    return path.split('/').filter((s) => s.length > 0)
}

/** Decide whether a file is openable as text. Anything starting with `text/`
 *  is treated as text; additional non-`text/*` mimes (e.g. `application/json`,
 *  `application/luau`) are accepted when the caller supplies them. The
 *  language registry is the source of truth for the latter set. */
export function isTextContentType(
    contentType: string | undefined,
    extraTextMimes?: readonly string[],
): boolean {
    if (!contentType) return false
    if (contentType.startsWith('text/')) return true
    if (extraTextMimes && extraTextMimes.includes(contentType)) return true
    return false
}
