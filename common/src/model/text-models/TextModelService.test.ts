import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ChangeSet } from '@codemirror/state'

import type { HCClient, MapFile } from '@hollowcube/api'

import { FileTreeService } from '../files/FileTreeService'
import { PendingFilesService } from '../files/PendingFilesService'
import type { TextModelChange } from './TextModel'
import { TextModelService } from './TextModelService'

type FakeClient = {
    client: HCClient
    calls: { update: Array<{ path: string; body: string }> }
    setNextUpdateError: (e: unknown) => void
    setUpdateDelay: (ms: number) => void
    setNextResult: (file: MapFile) => void
}

function mapFile(path: string, size = 0): MapFile {
    return { path, contentType: 'text/plain', size, hash: 'h' }
}

function makeFakeClient(): FakeClient {
    const state = {
        nextError: null as unknown,
        delayMs: 0,
        nextResult: null as MapFile | null,
    }
    const calls = { update: [] as Array<{ path: string; body: string }> }
    const client = {
        request: async (method: string, path: string, opts?: { body?: string }) => {
            if (method !== 'PUT') return undefined as unknown
            const filePath = extractFilePath(path)
            calls.update.push({ path: filePath, body: String(opts?.body ?? '') })
            if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs))
            if (state.nextError !== null) {
                const e = state.nextError
                state.nextError = null
                throw e
            }
            const result = state.nextResult ?? mapFile(filePath, String(opts?.body ?? '').length)
            state.nextResult = null
            return result as unknown
        },
        send: () => Promise.resolve({ status: 204, headers: new Headers() } as unknown as Response),
    } as unknown as HCClient
    return {
        client,
        calls,
        setNextUpdateError: (e) => {
            state.nextError = e
        },
        setUpdateDelay: (ms) => {
            state.delayMs = ms
        },
        setNextResult: (file) => {
            state.nextResult = file
        },
    }
}

function extractFilePath(reqPath: string): string {
    const idx = reqPath.indexOf('/files/')
    if (idx === -1) return reqPath
    return reqPath.slice(idx + '/files/'.length)
}

let fake: FakeClient
let fileTree: FileTreeService
let pendingFiles: PendingFilesService
let svc: TextModelService

beforeEach(() => {
    fake = makeFakeClient()
    fileTree = new FileTreeService({ projectId: 'p1', client: fake.client })
    pendingFiles = new PendingFilesService()
    svc = new TextModelService({
        projectId: 'p1',
        client: fake.client,
        fileTree,
        pendingFiles,
    })
})

afterEach(() => {
    svc.dispose()
    fileTree.dispose()
    pendingFiles.dispose()
})

describe('TextModelService — basic lifecycle', () => {
    test('getOrOpen creates a model with initial content', () => {
        const model = svc.getOrOpen('a.luau', 'hello')
        expect(model.content.peek()).toBe('hello')
        expect(model.original.peek()).toBe('hello')
        expect(model.dirty.peek()).toBe(false)
        expect(model.path.peek()).toBe('a.luau')
    })

    test('getOrOpen reuses existing model and bumps refcount', () => {
        const a = svc.getOrOpen('a.luau', 'hello')
        const b = svc.getOrOpen('a.luau', 'IGNORED')
        expect(a).toBe(b)
        expect(a.content.peek()).toBe('hello')
    })

    test('close decrements refcount; removes only at zero', () => {
        svc.getOrOpen('a.luau', 'hello')
        svc.getOrOpen('a.luau', 'hello')
        svc.close('a.luau')
        expect(svc.get('a.luau')).toBeDefined()
        svc.close('a.luau')
        expect(svc.get('a.luau')).toBeUndefined()
    })

    test('close with force removes regardless of refcount', () => {
        svc.getOrOpen('a.luau', 'hello')
        svc.getOrOpen('a.luau', 'hello')
        svc.close('a.luau', { force: true })
        expect(svc.get('a.luau')).toBeUndefined()
    })

    test('unsaved doc id parses to tempId, null path', () => {
        const model = svc.getOrOpen('unsaved:abc123', '')
        expect(model.path.peek()).toBeNull()
        expect(model.tempId).toBe('abc123')
    })
})

describe('TextModelService — content + dirty signals', () => {
    test('setContent updates content + dirty flag; discard reverts', () => {
        const m = svc.getOrOpen('a.luau', 'hi')
        m.setContent('hi there')
        expect(m.content.peek()).toBe('hi there')
        expect(m.dirty.peek()).toBe(true)
        m.discard()
        expect(m.content.peek()).toBe('hi')
        expect(m.dirty.peek()).toBe(false)
    })

    test('anyDirty reflects any model being dirty', () => {
        const a = svc.getOrOpen('a.luau', 'a')
        const b = svc.getOrOpen('b.luau', 'b')
        expect(svc.anyDirty.peek()).toBe(false)
        a.setContent('a!')
        expect(svc.anyDirty.peek()).toBe(true)
        a.discard()
        expect(svc.anyDirty.peek()).toBe(false)
        b.setContent('b!')
        expect(svc.anyDirty.peek()).toBe(true)
    })

    test('dirtyModels contains only dirty models', () => {
        const a = svc.getOrOpen('a.luau', 'a')
        const b = svc.getOrOpen('b.luau', 'b')
        a.setContent('aa')
        expect(svc.dirtyModels.peek().map((m) => m.id)).toEqual(['a.luau'])
        void b
    })
})

describe('TextModelService — save', () => {
    test('save with no dirty buffer is a noop', async () => {
        svc.getOrOpen('a.luau', 'x')
        const result = await svc.save('a.luau')
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.noop).toBe(true)
        expect(fake.calls.update).toHaveLength(0)
    })

    test('save calls API with current content and commits to that snapshot', async () => {
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        const result = await svc.save('a.luau')
        expect(result.ok).toBe(true)
        expect(fake.calls.update[0]?.body).toBe('y')
        expect(m.original.peek()).toBe('y')
        expect(m.dirty.peek()).toBe(false)
    })

    test('save on untitled with no path returns requires-path error', async () => {
        const m = svc.getOrOpen('unsaved:abc', '')
        m.setContent('hi')
        const result = await svc.save('unsaved:abc')
        if (result.ok) throw new Error('expected error')
        expect(result.error.kind).toBe('requires-path')
    })

    test('concurrent save() calls coalesce into one network request', async () => {
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        const p1 = svc.save('a.luau')
        const p2 = svc.save('a.luau')
        await Promise.all([p1, p2])
        // Second save sees the first one in flight, awaits, then notices
        // dirty=false (commit already happened) and noops.
        expect(fake.calls.update).toHaveLength(1)
    })

    test('typing during save leaves model dirty against the saved snapshot', async () => {
        fake.setUpdateDelay(20)
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        const savePromise = svc.save('a.luau')
        // Edit during the in-flight request.
        m.setContent('y!')
        await savePromise
        expect(m.original.peek()).toBe('y')
        expect(m.content.peek()).toBe('y!')
        expect(m.dirty.peek()).toBe(true)
    })

    test('first save of untitled with explicit path promotes the model', async () => {
        const tempId = pendingFiles.addUntitled()
        const docId = `unsaved:${tempId}`
        const m = svc.getOrOpen(docId, '')
        m.setContent('hello')
        const result = await svc.save(docId, { path: 'src/foo.luau' })
        expect(result.ok).toBe(true)
        // The original docId is gone; the new key is the path.
        expect(svc.get(docId)).toBeUndefined()
        const promoted = svc.get('src/foo.luau')
        expect(promoted).toBeDefined()
        expect(promoted?.path.peek()).toBe('src/foo.luau')
        expect(promoted?.tempId).toBeNull()
        // Pending entry cleared.
        expect(pendingFiles.get(tempId)).toBeUndefined()
    })

    // Regression: right-click "New File" in the tree creates a pending
    // entry that already has a chosen path; the tab opens against
    // `unsaved:<tempId>` and the model gets its target path via
    // `getOrOpen({ initialPath })`. First save must (a) rekey the model
    // from `unsaved:...` to the path, (b) call `pendingFiles.remove(tempId)`.
    // If the model is keyed by the path directly, save sees
    // `model.id === path`, skips rekey, leaves the pending entry behind,
    // and the file tree renders the same path twice — once canonical,
    // once pending — until refresh.
    test('first save of new-file-with-chosen-path rekeys and removes pending entry', async () => {
        const path = 'src/new-file.luau'
        const tempId = pendingFiles.addAtPath(path)
        const docId = `unsaved:${tempId}`
        const m = svc.getOrOpen(docId, '', { initialPath: path })
        // The model knows its target path immediately — that's what makes
        // autosave fire (autosave requires `model.path !== null`).
        expect(m.path.peek()).toBe(path)
        expect(m.tempId).toBe(tempId)
        m.setContent('hello')

        const result = await svc.save(docId)
        expect(result.ok).toBe(true)

        // Model rekeyed under the canonical path; old docId is gone.
        expect(svc.get(docId)).toBeUndefined()
        const promoted = svc.get(path)
        expect(promoted).toBeDefined()
        expect(promoted?.path.peek()).toBe(path)
        expect(promoted?.tempId).toBeNull()

        // The pending placeholder is removed — without this the file
        // tree would render `path` twice (canonical + pending).
        expect(pendingFiles.get(tempId)).toBeUndefined()
    })

    test('autosave fires for a new-file-with-chosen-path model', async () => {
        const path = 'src/autosaved.luau'
        const tempId = pendingFiles.addAtPath(path)
        const docId = `unsaved:${tempId}`
        const m = svc.getOrOpen(docId, '', { initialPath: path })
        m.setContent('typed')
        await new Promise((r) => setTimeout(r, 1000))
        expect(fake.calls.update).toHaveLength(1)
        expect(fake.calls.update[0]?.path).toBe(path)
        // Autosave should also have triggered the rekey + cleanup path.
        expect(pendingFiles.get(tempId)).toBeUndefined()
        expect(svc.get(path)).toBeDefined()
    })

    test('save error surfaces a network SaveError', async () => {
        fake.setNextUpdateError(new Error('offline'))
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        const result = await svc.save('a.luau')
        if (result.ok) throw new Error('expected error')
        expect(result.error.kind).toBe('network')
        expect(m.dirty.peek()).toBe(true)
    })

    test('save patches the file-tree map after success', async () => {
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        await svc.save('a.luau')
        expect(fileTree.get('a.luau')?.size).toBe(1)
    })
})

describe('TextModelService — autosave', () => {
    test('schedules a trailing-edge save after edits stop', async () => {
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        // Wait past the 800ms debounce.
        await new Promise((r) => setTimeout(r, 1000))
        expect(fake.calls.update).toHaveLength(1)
    })

    test('does not autosave untitled docs (no path)', async () => {
        const m = svc.getOrOpen('unsaved:abc', '')
        m.setContent('hi')
        await new Promise((r) => setTimeout(r, 1000))
        expect(fake.calls.update).toHaveLength(0)
    })

    test('cancels prior timer on subsequent edits', async () => {
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        await new Promise((r) => setTimeout(r, 400))
        m.setContent('y2')
        await new Promise((r) => setTimeout(r, 400))
        // Only the last edit should fire.
        expect(fake.calls.update).toHaveLength(0)
        await new Promise((r) => setTimeout(r, 500))
        expect(fake.calls.update).toHaveLength(1)
        expect(fake.calls.update[0]?.body).toBe('y2')
    }, 5000)
})

describe('TextModelService — external changes', () => {
    test('handleExternalChange updates clean buffer transparently', () => {
        const m = svc.getOrOpen('a.luau', 'old')
        svc.handleExternalChange('a.luau', 'new')
        expect(m.original.peek()).toBe('new')
        expect(m.content.peek()).toBe('new')
        expect(m.dirty.peek()).toBe(false)
    })

    test('handleExternalChange on dirty buffer records a conflict', () => {
        const m = svc.getOrOpen('a.luau', 'old')
        m.setContent('locally edited')
        svc.handleExternalChange('a.luau', 'remotely changed')
        expect(svc.conflicts.peek().has('a.luau')).toBe(true)
        expect(m.content.peek()).toBe('locally edited')
    })

    test('handleExternalDelete marks the model orphaned; subsequent save fails', async () => {
        const m = svc.getOrOpen('a.luau', 'x')
        m.setContent('y')
        svc.handleExternalDelete('a.luau')
        expect(m.orphaned.peek()).toBe(true)
        const result = await svc.save('a.luau')
        if (result.ok) throw new Error('expected error')
        expect(result.error.kind).toBe('orphaned')
    })

    test('keepLocal clears the conflict marker', () => {
        const m = svc.getOrOpen('a.luau', 'old')
        m.setContent('local')
        svc.handleExternalChange('a.luau', 'remote')
        svc.keepLocal('a.luau')
        expect(svc.conflicts.peek().has('a.luau')).toBe(false)
        void m
    })

    test('acceptExternal reverts to original and clears conflict', () => {
        const m = svc.getOrOpen('a.luau', 'old')
        m.setContent('local')
        svc.handleExternalChange('a.luau', 'remote')
        svc.acceptExternal('a.luau')
        expect(svc.conflicts.peek().has('a.luau')).toBe(false)
        // External change was rejected (dirty), but acceptExternal calls
        // discard() — which reverts content to the model's original (the
        // original buffer 'old' since the conflict path skipped setOriginal).
        expect(m.content.peek()).toBe(m.original.peek())
    })
})

describe('TextModelService — Text-backed doc + change stream', () => {
    test('text signal mirrors content; both seeded from initialContent', () => {
        const m = svc.getOrOpen('a.luau', 'hello\nworld')
        expect(m.text.peek().toString()).toBe('hello\nworld')
        expect(m.content.peek()).toBe('hello\nworld')
        expect(m.text.peek().lines).toBe(2)
    })

    test('applyChanges updates text + fires change event with origin', () => {
        const m = svc.getOrOpen('a.luau', 'hello')
        const events: TextModelChange[] = []
        const unsub = m.changes((e) => events.push(e))
        const origin = Symbol('view-1')
        const changes = ChangeSet.of([{ from: 5, insert: '!' }], 5)
        m.applyChanges(changes, origin)
        expect(m.content.peek()).toBe('hello!')
        expect(m.dirty.peek()).toBe(true)
        expect(events).toHaveLength(1)
        expect(events[0]?.origin).toBe(origin)
        expect(events[0]?.changes.empty).toBe(false)
        unsub()
    })

    test('applyChanges with an empty ChangeSet is a noop (no event)', () => {
        const m = svc.getOrOpen('a.luau', 'hello')
        const events: TextModelChange[] = []
        const unsub = m.changes((e) => events.push(e))
        m.applyChanges(ChangeSet.empty(5))
        expect(m.content.peek()).toBe('hello')
        expect(events).toHaveLength(0)
        unsub()
    })

    test('setContent fires a change event with origin=null', () => {
        const m = svc.getOrOpen('a.luau', 'hello')
        const events: TextModelChange[] = []
        const unsub = m.changes((e) => events.push(e))
        m.setContent('goodbye')
        expect(m.content.peek()).toBe('goodbye')
        expect(events).toHaveLength(1)
        expect(events[0]?.origin).toBeNull()
        unsub()
    })

    test('discard fires a change event reverting to original', () => {
        const m = svc.getOrOpen('a.luau', 'original')
        m.setContent('edited')
        const events: TextModelChange[] = []
        const unsub = m.changes((e) => events.push(e))
        m.discard()
        expect(m.content.peek()).toBe('original')
        expect(m.dirty.peek()).toBe(false)
        expect(events).toHaveLength(1)
        unsub()
    })

    test('handleExternalChange routes through the change stream as a transaction', () => {
        // Critical contract: views attached to this model dispatch
        // received ChangeSets onto their own EditorState, which maps
        // their selection through the changes. If the SSE handler ever
        // regressed to a direct content-set (no ChangeSet), attached
        // views would lose cursor/scroll on every external update.
        const m = svc.getOrOpen('a.luau', 'old')
        const events: TextModelChange[] = []
        const unsub = m.changes((e) => events.push(e))
        svc.handleExternalChange('a.luau', 'new')
        expect(m.content.peek()).toBe('new')
        expect(events).toHaveLength(1)
        expect(events[0]?.origin).toBeNull()
        unsub()
    })
})

describe('TextModelService — disposal', () => {
    test('dispose clears models and stops effects (idempotent)', () => {
        svc.getOrOpen('a.luau', 'x')
        svc.dispose()
        svc.dispose()
        expect(svc.get('a.luau')).toBeUndefined()
        expect(svc.anyDirty.peek()).toBe(false)
    })
})

describe('TextModelService — pruneToIds (layout-driven GC)', () => {
    test('drops models whose id is not in the live set', () => {
        svc.getOrOpen('a.luau', 'x')
        svc.getOrOpen('b.luau', 'y')
        svc.getOrOpen('c.luau', 'z')
        svc.pruneToIds(new Set(['b.luau']))
        expect(svc.get('a.luau')).toBeUndefined()
        expect(svc.get('b.luau')).toBeDefined()
        expect(svc.get('c.luau')).toBeUndefined()
        expect(svc.openModels.peek().map((m) => m.id)).toEqual(['b.luau'])
    })

    test('drops models regardless of refcount', () => {
        svc.getOrOpen('a.luau', 'x')
        svc.getOrOpen('a.luau', 'IGNORED')
        svc.getOrOpen('a.luau', 'IGNORED')
        svc.pruneToIds(new Set())
        expect(svc.get('a.luau')).toBeUndefined()
    })

    test('empty live set drops everything', () => {
        svc.getOrOpen('a.luau', 'x')
        svc.getOrOpen('b.luau', 'y')
        svc.pruneToIds(new Set())
        expect(svc.openModels.peek()).toEqual([])
    })

    test('preserves dirty models that are still live', () => {
        const a = svc.getOrOpen('a.luau', 'x')
        a.setContent('xy')
        expect(a.dirty.peek()).toBe(true)
        svc.pruneToIds(new Set(['a.luau']))
        expect(svc.get('a.luau')).toBeDefined()
        expect(svc.get('a.luau')?.dirty.peek()).toBe(true)
    })
})
