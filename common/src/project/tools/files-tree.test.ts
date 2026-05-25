import { describe, expect, test } from 'bun:test'

import type { MapFile } from '@hollowcube/api'

import type { PendingFile } from '../../model/files'
import { buildFileTree } from './files-tree'

function mapFile(path: string): MapFile {
    return { path, contentType: 'text/plain', size: 0, hash: 'h' }
}

function pending(tempId: string, path: string | null): PendingFile {
    return path === null ? { tempId, path, untitledTitle: 'Untitled-1' } : { tempId, path }
}

describe('buildFileTree — pending dedupe', () => {
    // Regression: in the new-file flow, a pending entry shares its path
    // with a canonical file briefly (or permanently, if cleanup is
    // missed). The tree must show that path exactly once. Without the
    // dedupe both nodes render — different ids (`src/foo.luau` vs
    // `pending:<tempId>`), same display path — which the user sees as a
    // duplicate row in the file browser.
    test('skips pending entries whose path already exists canonically', () => {
        const files = [mapFile('src/foo.luau')]
        const pendings = [pending('pending-abc', 'src/foo.luau')]
        const tree = buildFileTree(files, pendings)

        const src = tree.find((n) => n.type === 'folder' && n.name === 'src')
        if (!src || src.type !== 'folder') throw new Error('expected src folder')
        const fooNodes = src.children.filter((n) => n.type === 'file' && n.name === 'foo.luau')
        expect(fooNodes).toHaveLength(1)
        // The surviving node is the canonical one (its id is the path).
        expect(fooNodes[0]?.id).toBe('src/foo.luau')
    })

    test('keeps pending entries that are not yet canonical', () => {
        const files: MapFile[] = []
        const pendings = [pending('pending-xyz', 'src/new.luau')]
        const tree = buildFileTree(files, pendings)

        const src = tree.find((n) => n.type === 'folder' && n.name === 'src')
        if (!src || src.type !== 'folder') throw new Error('expected src folder')
        const newNodes = src.children.filter((n) => n.type === 'file' && n.name === 'new.luau')
        expect(newNodes).toHaveLength(1)
        expect(newNodes[0]?.id).toBe('pending:pending-xyz')
    })

    test('purely-untitled pending entries (no path) are ignored', () => {
        const tree = buildFileTree([mapFile('a.luau')], [pending('pending-u1', null)])
        // Only the canonical file is in the tree; untitled has no row.
        expect(tree).toHaveLength(1)
        expect(tree[0]?.type === 'file' && tree[0].name).toBe('a.luau')
    })
})
