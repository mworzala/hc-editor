// `TextModelService` — owns the in-memory text models for every open
// editor tab.
//
// Document ids:
//   • File with a known path → `docId = path`
//   • Untitled file          → `docId = 'unsaved:' + tempId`
//
// Save is single-flight per docId, captures the content snapshot before
// the network call, and commits to that snapshot (not current content)
// so concurrent edits during the round-trip stay correctly dirty.
//
// Autosave: one `effect` per model auto-tracks `content` / `dirty` /
// `path` / `orphaned` and reschedules a trailing-edge timer. Untitled
// docs (path === null) are NOT autosaved — they require an explicit save
// (which surfaces a save-as prompt elsewhere).
//
// SSE-driven external-change handlers (`handleExternalChange`, etc.) are
// invoked by `ServerEventsConnection` when the server reports a change to
// a file we have open.

import {
    v1MapFilesUpdate,
    type HCClient,
    type MapFile,
} from '@hollowcube/api'

import type { ActionRegistry } from '../actions/ActionRegistry'
import type { ActiveEditorRegistry } from '../active-editor/ActiveEditorRegistry'
import {
    computed,
    effect,
    signal,
    type ReadonlySignal,
} from '../foundation/signal'
import { Emitter, type Event } from '../foundation/emitter'
import type { FileTreeService } from '../files/FileTreeService'
import type { PendingFilesService } from '../files/PendingFilesService'
import type { WorkspaceLayoutService } from '../workspace/WorkspaceLayoutService'
import { makeId, resolveTargetLeaf } from '../workspace/tree-helpers'
import {
    createTextModel,
    type DocumentId,
    type TextModel,
    type TextModelInternal,
} from './TextModel'

// Kept in sync with `common/src/project/editors/text-kind.ts`. The model
// layer can't import from the project layer, and `editor.newFile` opens a
// text-editor tab — so the kind constant is mirrored here.
const TEXT_EDITOR_KIND = 'editor:text'

const AUTOSAVE_DELAY_MS = 800

export type SaveResult =
    | { ok: true; noop?: boolean; file?: MapFile }
    | { ok: false; error: SaveError }

export type SaveError =
    | { kind: 'requires-path' }
    | { kind: 'network'; cause: unknown }
    | { kind: 'orphaned' }

export type TextModelServiceEvent =
    | { kind: 'modelRekeyed'; oldId: DocumentId; newId: DocumentId }
    | { kind: 'saveSucceeded'; docId: DocumentId; path: string }
    | { kind: 'saveFailed'; docId: DocumentId; error: SaveError }
    | { kind: 'conflictAppeared'; path: string }

export interface TextModelServiceDeps {
    projectId: string
    client: HCClient
    fileTree: FileTreeService
    pendingFiles: PendingFilesService
    /** Optional. When provided the service registers
     *  `editor.save` / `editor.saveAll` / `editor.revert` / `editor.newFile`
     *  in the constructor. Tests that don't exercise actions can omit. */
    actions?: ActionRegistry
    /** Required when `actions` is provided. The save/format/revert
     *  handlers resolve the focused doc via `activeEditor.activeDocId`. */
    activeEditor?: ActiveEditorRegistry
    /** Required when `actions` is provided. `editor.newFile` opens a new
     *  untitled tab through this service. */
    layout?: WorkspaceLayoutService
}

export class TextModelService {
    private readonly _modelsInternal = new Map<DocumentId, TextModelInternal>()
    private readonly _modelIds = signal<readonly DocumentId[]>([])
    private readonly _conflicts = signal<ReadonlySet<string>>(new Set())
    private readonly _events = new Emitter<TextModelServiceEvent>()

    private readonly _refcounts = new Map<DocumentId, number>()
    private readonly _inflight = new Map<DocumentId, Promise<SaveResult>>()
    private readonly _autosaveDisposers = new Map<DocumentId, () => void>()
    private readonly _autosaveTimers = new Map<DocumentId, ReturnType<typeof setTimeout>>()

    /** All currently-open models, in registration order. Refcount > 0. */
    readonly openModels: ReadonlySignal<readonly TextModel[]> = computed(() => {
        const ids = this._modelIds.value
        const out: TextModel[] = []
        for (const id of ids) {
            const m = this._modelsInternal.get(id)
            if (m) out.push(m)
        }
        return out
    })

    /** Sorted list of dirty models. */
    readonly dirtyModels: ReadonlySignal<readonly TextModel[]> = computed(() => {
        const ids = this._modelIds.value
        const out: TextModel[] = []
        for (const id of ids) {
            const m = this._modelsInternal.get(id)
            if (m && m.dirty.value) out.push(m)
        }
        return out
    })

    /** `true` if any model is dirty. */
    readonly anyDirty: ReadonlySignal<boolean> = computed(() => this.dirtyModels.value.length > 0)

    /** Set of paths where the local buffer diverges from the server's
     *  latest content (SSE-driven; `ServerEventsConnection` populates it
     *  via `handleExternalChange`). */
    readonly conflicts: ReadonlySignal<ReadonlySet<string>> = this._conflicts

    readonly events: Event<TextModelServiceEvent> = this._events.event

    private readonly _actionDisposers: Array<() => void> = []

    constructor(private readonly deps: TextModelServiceDeps) {
        if (deps.actions) this._registerActions()
    }

    /** Open a model (or reuse an existing one). Refcounted: each call
     *  bumps the refcount; `close` decrements. The first opener supplies
     *  the initial content; subsequent opens ignore it. */
    getOrOpen(docId: DocumentId, initialContent: string): TextModel {
        const existing = this._modelsInternal.get(docId)
        if (existing) {
            this._refcounts.set(docId, (this._refcounts.get(docId) ?? 0) + 1)
            return existing
        }
        const { path, tempId } = parseDocId(docId)
        const model = createTextModel({ id: docId, tempId, path, initialContent })
        this._modelsInternal.set(docId, model)
        this._refcounts.set(docId, 1)
        this._modelIds.value = [...this._modelIds.peek(), docId]
        this._installAutosaveFor(model)
        return model
    }

    /** Look up an existing model. Does not bump refcount. */
    get(docId: DocumentId): TextModel | undefined {
        return this._modelsInternal.get(docId)
    }

    /** Decrement the refcount; remove when it hits zero unless `force` is
     *  set (callers should prompt on dirty docs). Dirty state survives
     *  any number of opens — the prompt-to-close decision is the UI's. */
    close(docId: DocumentId, opts?: { force?: boolean }): void {
        const cur = this._refcounts.get(docId) ?? 0
        if (cur <= 1 || opts?.force) {
            this._removeModel(docId)
            return
        }
        this._refcounts.set(docId, cur - 1)
    }

    /** Save the model under `docId`. Captures the content snapshot
     *  before the network call so concurrent edits remain dirty against
     *  the saved value. Single-flight per docId — concurrent calls await
     *  the in-flight promise. */
    async save(docId: DocumentId, opts?: { path?: string }): Promise<SaveResult> {
        const model = this._modelsInternal.get(docId)
        if (!model) return { ok: true, noop: true }
        if (!model.dirty.peek()) return { ok: true, noop: true }
        if (model.orphaned.peek()) {
            const error: SaveError = { kind: 'orphaned' }
            this._events.fire({ kind: 'saveFailed', docId, error })
            return { ok: false, error }
        }
        const path = opts?.path ?? model.path.peek()
        if (!path) return { ok: false, error: { kind: 'requires-path' } }

        const inflight = this._inflight.get(docId)
        if (inflight) {
            await inflight.catch(() => {})
            if (!model.dirty.peek()) return { ok: true, noop: true }
        }

        const snapshot = model.content.peek()
        const promise = this._doSave(model, path, snapshot)
        this._inflight.set(docId, promise)
        try {
            return await promise
        } finally {
            if (this._inflight.get(docId) === promise) this._inflight.delete(docId)
        }
    }

    /** Save every dirty model. Returns a map of results per docId. */
    async saveAll(): Promise<ReadonlyMap<DocumentId, SaveResult>> {
        const results = new Map<DocumentId, SaveResult>()
        const ids = this.dirtyModels.peek().map((m) => m.id)
        await Promise.all(
            ids.map(async (id) => {
                const r = await this.save(id)
                results.set(id, r)
            }),
        )
        return results
    }

    /** External-change handler — paste in new content from SSE.
     *  `ServerEventsConnection` calls this when the server reports a
     *  change to a path we have open. If the local buffer is clean,
     *  update both original + content. If dirty, mark a conflict and
     *  leave the local edit. */
    handleExternalChange(path: string, newContent: string): void {
        const model = this._modelsInternal.get(path)
        if (!model) return
        if (model.dirty.peek()) {
            this._addConflict(path)
            this._events.fire({ kind: 'conflictAppeared', path })
            return
        }
        model.setOriginal(newContent)
        model.setContent(newContent)
    }

    /** External-delete handler — server says the file is gone. Mark the
     *  model orphaned so subsequent saves fail closed. */
    handleExternalDelete(path: string): void {
        const model = this._modelsInternal.get(path)
        if (!model) return
        model.markOrphaned()
    }

    /** External-rename handler — repoint a model from `oldPath` to
     *  `newPath`. */
    handleRename(oldPath: string, newPath: string): void {
        const model = this._modelsInternal.get(oldPath)
        if (!model) return
        this._rekey(oldPath, newPath)
        model.setPath(newPath)
    }

    /** Drop every model whose id is not in `liveDocIds`, regardless of
     *  refcount. Used by `Project`'s layout-driven GC to release models
     *  that are no longer referenced by any open editor tab. Caller is
     *  responsible for prompting the user on dirty closes — this method
     *  bypasses all such checks (matches `close()`'s behavior at
     *  refcount === 0). */
    pruneToIds(liveDocIds: ReadonlySet<DocumentId>): void {
        for (const id of this._modelIds.peek()) {
            if (!liveDocIds.has(id)) this._removeModel(id)
        }
    }

    /** Conflict resolution: keep the local buffer. Clears the conflict
     *  marker; `original` is left where it was so subsequent saves still
     *  diverge. */
    keepLocal(path: string): void {
        this._removeConflict(path)
    }

    /** Conflict resolution: drop the local buffer, accept the server's
     *  latest. `ServerEventsConnection` wires fresh content into this
     *  service via `handleExternalChange`; this resolver is the explicit
     *  user choice to discard local edits after a conflict is flagged. */
    acceptExternal(path: string): void {
        const model = this._modelsInternal.get(path)
        if (!model) return
        model.discard()
        this._removeConflict(path)
    }

    dispose(): void {
        for (const d of this._actionDisposers) d()
        this._actionDisposers.length = 0
        for (const dispose of this._autosaveDisposers.values()) dispose()
        this._autosaveDisposers.clear()
        for (const t of this._autosaveTimers.values()) clearTimeout(t)
        this._autosaveTimers.clear()
        this._modelsInternal.clear()
        this._refcounts.clear()
        this._inflight.clear()
        this._modelIds.value = []
        this._conflicts.value = new Set()
        this._events.dispose()
    }

    private _registerActions(): void {
        const { actions, activeEditor, layout, pendingFiles } = this.deps
        if (!actions || !activeEditor) return

        const focusedEntrySave = () => {
            const tabId = activeEditor.activeDocId.peek()
            if (!tabId) return
            const entry = activeEditor.get(tabId)
            if (entry?.save) void entry.save()
        }

        this._actionDisposers.push(
            actions.register({
                id: 'editor.save',
                title: 'Save',
                group: 'edit',
                keybinding: '$mod+s',
                when: 'editor.text && editor.dirty',
                menu: { path: 'file', group: 'save', order: 10 },
                run: () => focusedEntrySave(),
            }),
            actions.register({
                id: 'editor.saveAll',
                title: 'Save All',
                group: 'edit',
                when: 'editor.anyDirty',
                menu: { path: 'file', group: 'save', order: 20 },
                run: () => {
                    void this.saveAll()
                },
            }),
        )

        if (layout) {
            this._actionDisposers.push(
                actions.register({
                    id: 'editor.newFile',
                    title: 'New Untitled File',
                    keybinding: '$mod+n',
                    menu: { path: 'file', group: 'new', order: 10 },
                    run: () => {
                        const tempId = pendingFiles.addUntitled()
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
                    },
                }),
            )
        }
    }

    // ------------- internals -------------

    private async _doSave(
        model: TextModelInternal,
        path: string,
        snapshot: string,
    ): Promise<SaveResult> {
        let file: MapFile
        try {
            file = await v1MapFilesUpdate(
                this.deps.client,
                this.deps.projectId,
                path,
                snapshot,
                'text/plain',
            )
        } catch (cause) {
            const error: SaveError = { kind: 'network', cause }
            this._events.fire({ kind: 'saveFailed', docId: model.id, error })
            return { ok: false, error }
        }
        // Commit against the snapshot we sent — preserves dirty state
        // for any keystrokes that landed during the round trip.
        model.commit(snapshot)
        // Promote untitled docs to their path id.
        if (model.id !== path) {
            const oldId = model.id
            const tempId = model.tempId
            this._rekey(oldId, path)
            model.setPath(path)
            if (tempId) this.deps.pendingFiles.remove(tempId)
            this._events.fire({ kind: 'modelRekeyed', oldId, newId: path })
        }
        // Patch the file-tree's flat map so the new size/hash are visible.
        this.deps.fileTree.upsert(file)
        this._events.fire({ kind: 'saveSucceeded', docId: path, path })
        return { ok: true, file }
    }

    private _installAutosaveFor(model: TextModelInternal): void {
        const stop = effect(() => {
            // Read every signal we want to react to (auto-tracks via .value).
            const _content = model.content.value
            const dirty = model.dirty.value
            const path = model.path.value
            const orphaned = model.orphaned.value
            void _content
            // Clear any pending timer so each change resets the trailing edge.
            const prev = this._autosaveTimers.get(model.id)
            if (prev) {
                clearTimeout(prev)
                this._autosaveTimers.delete(model.id)
            }
            if (!dirty || !path || orphaned) return

            const docId = model.id
            const timer = setTimeout(() => {
                this._autosaveTimers.delete(docId)
                void this.save(docId)
            }, AUTOSAVE_DELAY_MS)
            this._autosaveTimers.set(model.id, timer)
        })
        this._autosaveDisposers.set(model.id, stop)
    }

    private _rekey(oldId: DocumentId, newId: DocumentId): void {
        if (oldId === newId) return
        const model = this._modelsInternal.get(oldId)
        if (!model) return
        this._modelsInternal.delete(oldId)
        model.rekey(newId)
        this._modelsInternal.set(newId, model)
        const refs = this._refcounts.get(oldId)
        if (refs !== undefined) {
            this._refcounts.delete(oldId)
            this._refcounts.set(newId, refs)
        }
        const auto = this._autosaveDisposers.get(oldId)
        if (auto) {
            this._autosaveDisposers.delete(oldId)
            this._autosaveDisposers.set(newId, auto)
        }
        const timer = this._autosaveTimers.get(oldId)
        if (timer) {
            this._autosaveTimers.delete(oldId)
            this._autosaveTimers.set(newId, timer)
        }
        this._modelIds.value = this._modelIds.peek().map((id) => (id === oldId ? newId : id))
    }

    private _removeModel(docId: DocumentId): void {
        const stop = this._autosaveDisposers.get(docId)
        if (stop) {
            stop()
            this._autosaveDisposers.delete(docId)
        }
        const timer = this._autosaveTimers.get(docId)
        if (timer) {
            clearTimeout(timer)
            this._autosaveTimers.delete(docId)
        }
        this._modelsInternal.delete(docId)
        this._refcounts.delete(docId)
        this._modelIds.value = this._modelIds.peek().filter((id) => id !== docId)
    }

    private _addConflict(path: string): void {
        const cur = this._conflicts.peek()
        if (cur.has(path)) return
        const next = new Set(cur)
        next.add(path)
        this._conflicts.value = next
    }

    private _removeConflict(path: string): void {
        const cur = this._conflicts.peek()
        if (!cur.has(path)) return
        const next = new Set(cur)
        next.delete(path)
        this._conflicts.value = next
    }
}

/** `path:foo/bar.luau` → `{ path: 'foo/bar.luau', tempId: null }`.
 *  `unsaved:abc123`    → `{ path: null, tempId: 'abc123' }`.
 *  Plain string (no scheme) is treated as a path. */
function parseDocId(docId: DocumentId): { path: string | null; tempId: string | null } {
    if (docId.startsWith('unsaved:')) {
        return { path: null, tempId: docId.slice('unsaved:'.length) }
    }
    return { path: docId, tempId: null }
}
