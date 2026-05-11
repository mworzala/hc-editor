import { Badge } from '@hollowcube/design-system/components/badge'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '@hollowcube/design-system/components/breadcrumb'
import { FileTree, type FileTreeNode } from '@hollowcube/design-system/components/file-tree'
import { Input } from '@hollowcube/design-system/components/input'
import { CodeEditor } from '@hollowcube/design-system/editor'
import samplePackage from '@hollowcube/design-system/editor/sample.json'
import * as React from 'react'

import { Workspace, createWorkspaceStore, type Tab, type WorkspaceState } from '../workspace'

const SAMPLE_JSON = JSON.stringify(samplePackage, null, 4)

const README_TEXT = `# Hollowcube Editor

Welcome to the workspace demo. Try the following:

  • Drag tabs around within a pane to reorder them
  • Drag a tab from one tool dock to another (zone-local — tools to tools, editors to editors)
  • Drag an editor tab onto the LEFT / RIGHT / TOP / BOTTOM edge of the editor area to split
  • Resize panels by dragging the gaps between them
  • Toggle the L / B / R buttons in the toolbar to hide / show the side docks
  • Reset layout clears localStorage and reverts to defaults
`

const TREE: FileTreeNode[] = [
    {
        type: 'folder',
        name: 'src',
        id: 'src',
        defaultOpen: true,
        children: [
            { type: 'file', name: 'main.tsx', id: 'src/main.tsx' },
            { type: 'file', name: 'app.tsx', id: 'src/app.tsx' },
            {
                type: 'folder',
                name: 'workspace',
                id: 'src/workspace',
                defaultOpen: false,
                children: [
                    { type: 'file', name: 'index.ts', id: 'src/workspace/index.ts' },
                    { type: 'file', name: 'Workspace.tsx', id: 'src/workspace/Workspace.tsx' },
                ],
            },
        ],
    },
    { type: 'file', name: 'package.json', id: 'package.json' },
    { type: 'file', name: 'README.md', id: 'README.md' },
]

function renderTab(tab: Tab): React.ReactNode {
    switch (tab.kind) {
        case 'files':
            return <FilesPane />
        case 'search':
            return <SearchPane />
        case 'terminal':
            return <TerminalPane />
        case 'problems':
            return <ProblemsPane />
        case 'output':
            return <OutputPane />
        case 'outline':
            return <OutlinePane />
        case 'properties':
            return <PropertiesPane />
        case 'editor-json':
            return (
                <CodeEditor
                    value={typeof tab.payload?.value === 'string' ? tab.payload.value : SAMPLE_JSON}
                />
            )
        case 'editor-text':
            return (
                <pre className='m-0 h-full overflow-auto p-4 text-[0.78rem] leading-relaxed whitespace-pre-wrap'>
                    {typeof tab.payload?.value === 'string' ? tab.payload.value : README_TEXT}
                </pre>
            )
        default:
            return (
                <div className='text-muted-foreground p-4 text-xs'>
                    Unknown tab kind: <code>{tab.kind}</code>
                </div>
            )
    }
}

function FilesPane() {
    const [selected, setSelected] = React.useState<string | null>(null)
    return (
        <div className='p-2'>
            <FileTree
                nodes={TREE}
                selectedId={selected}
                onSelect={(id, node) => {
                    if (node.type === 'file') setSelected(id)
                }}
            />
        </div>
    )
}

function SearchPane() {
    return (
        <div className='flex flex-col gap-2 p-3'>
            <Input placeholder='Search across files…' />
            <p className='text-muted-foreground text-xs'>Mock — no results yet.</p>
        </div>
    )
}

function TerminalPane() {
    return (
        <div className='h-full bg-background p-3'>
            <pre className='m-0 font-mono text-[0.72rem] leading-relaxed'>
                {`$ bun run dev:web
   VITE v7.3.3  ready in 312 ms
   ➜ Local:   http://localhost:5173/
$ bun test
   ✓ workspace store reducer (12 cases)
   ✓ editor extensions (8 cases)
$ █`}
            </pre>
        </div>
    )
}

function ProblemsPane() {
    return (
        <ul className='flex flex-col gap-1 p-3 text-[0.75rem]'>
            <li className='flex items-center gap-2'>
                <Badge variant='warning'>warn</Badge>
                <span className='font-mono'>package.json:18</span>
                <span className='text-muted-foreground'>Unused dependency `lodash`</span>
            </li>
            <li className='flex items-center gap-2'>
                <Badge variant='destructive'>error</Badge>
                <span className='font-mono'>src/main.tsx:42</span>
                <span className='text-muted-foreground'>
                    `useState` is not exported from &apos;react&apos;
                </span>
            </li>
        </ul>
    )
}

function OutputPane() {
    return (
        <pre className='m-0 h-full overflow-auto p-3 font-mono text-[0.72rem] leading-relaxed'>
            {`[15:22:01] Build started
[15:22:02] Resolved 462 packages
[15:22:03] Compiled 188 modules in 1.4s
[15:22:03] Build succeeded`}
        </pre>
    )
}

function OutlinePane() {
    return (
        <ul className='flex flex-col gap-0.5 p-3 text-[0.75rem]'>
            <li className='font-mono'>📦 package</li>
            <li className='pl-4 font-mono'>📁 scripts</li>
            <li className='pl-8 font-mono'>▶ start</li>
            <li className='pl-8 font-mono'>▶ build</li>
            <li className='pl-4 font-mono'>📁 dependencies</li>
        </ul>
    )
}

function PropertiesPane() {
    const rows: [string, string][] = [
        ['name', '@hollowcube/editor'],
        ['version', '0.1.0'],
        ['type', 'module'],
        ['tabSize', '4'],
        ['theme', 'armada-dark'],
    ]
    return (
        <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-3 text-[0.75rem]'>
            {rows.map(([k, v]) => (
                <React.Fragment key={k}>
                    <dt className='text-muted-foreground'>{k}</dt>
                    <dd className='font-mono'>{v}</dd>
                </React.Fragment>
            ))}
        </dl>
    )
}

const INITIAL: WorkspaceState = {
    columnSizes: [18, 64, 18],
    middleSizes: [70, 30],
    docksVisible: { left: true, right: true, bottom: true },
    left: {
        tabs: [
            { id: 'files', kind: 'files', title: 'Files' },
            { id: 'search', kind: 'search', title: 'Search' },
        ],
        activeId: 'files',
    },
    right: {
        tabs: [
            { id: 'outline', kind: 'outline', title: 'Outline' },
            { id: 'properties', kind: 'properties', title: 'Properties' },
        ],
        activeId: 'outline',
    },
    bottom: {
        tabs: [
            { id: 'terminal', kind: 'terminal', title: 'Terminal' },
            { id: 'problems', kind: 'problems', title: 'Problems' },
            { id: 'output', kind: 'output', title: 'Output' },
        ],
        activeId: 'terminal',
    },
    center: {
        kind: 'leaf',
        id: 'leaf-root',
        tabs: [
            { id: 'pkg', kind: 'editor-json', title: 'package.json' },
            { id: 'readme', kind: 'editor-text', title: 'README.md' },
        ],
        activeId: 'pkg',
    },
}

const useWorkspaceStore = createWorkspaceStore({
    storageKey: 'hc-workspace-demo-v1',
    initialState: INITIAL,
})

export default function WorkspacePage() {
    return (
        <div className='flex h-svh w-full flex-col bg-background'>
            <header className='flex flex-col gap-1 border-b border-border bg-surface px-6 py-3'>
                <Breadcrumb>
                    <BreadcrumbList>
                        <BreadcrumbItem>
                            <BreadcrumbLink href='/'>hollowcube</BreadcrumbLink>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                            <BreadcrumbPage>Workspace</BreadcrumbPage>
                        </BreadcrumbItem>
                    </BreadcrumbList>
                </Breadcrumb>
                <h1 className='text-xl font-medium tracking-tight'>Workspace</h1>
            </header>
            <div className='min-h-0 flex-1'>
                <Workspace useStore={useWorkspaceStore} renderTab={renderTab} />
            </div>
        </div>
    )
}
