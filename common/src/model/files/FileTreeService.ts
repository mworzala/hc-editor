// `FileTreeService` — owns the project's file metadata as a flat
// `Map<path, MapFile>` plus mutations (install / upsert / remove / rename
// / delete). The hierarchical tree shape consumed by the file browser is
// computed at render time from this map (the tree builder takes pending
// entries and runtime extras like inline rename rows / new-file rows that
// don't belong on the service).
//
// `installAll` is called once by `ProjectBootstrap` after the editor
// bootstrap resolves; `refresh()` re-fetches from `ServerEventsConnection`
// on each SSE event; `upsert` / `remove` are also reachable from save
// flows and explicit deletes.

import type { HCClient, MapFile } from '@hollowcube/api'
import { v1MapEditorBootstrap, v1MapFilesDelete, v1MapFilesUpdate } from '@hollowcube/api'

import { computed, signal, type ReadonlySignal } from '../foundation/signal'

export interface FileTreeServiceDeps {
    projectId: string
    client: HCClient
}

export type RenameResult =
    | { ok: true; file: MapFile }
    | {
          ok: false
          error:
              | { kind: 'exists' }
              | { kind: 'write'; cause: unknown }
              | { kind: 'read'; cause: unknown }
      }

export type DeleteResult = { ok: true } | { ok: false; error: { kind: 'network'; cause: unknown } }

export class FileTreeService {
    private readonly _byPath = signal<ReadonlyMap<string, MapFile>>(new Map())

    /** Flat path → MapFile map. Authoritative storage. */
    readonly files: ReadonlySignal<ReadonlyMap<string, MapFile>> = this._byPath

    /** Files as a sorted array. Convenient for `buildFileTree(list, …)`. */
    readonly list: ReadonlySignal<readonly MapFile[]> = computed(() => {
        const arr = [...this._byPath.value.values()]
        arr.sort((a, b) => a.path.localeCompare(b.path))
        return arr
    })

    constructor(private readonly deps: FileTreeServiceDeps) {}

    /** Re-fetch the editor bootstrap and replace the file map. Used by
     *  `ServerEventsConnection` on each SSE event so the tree reflects
     *  external changes (renames, deletes, new files on disk). */
    async refresh(): Promise<void> {
        const data = await v1MapEditorBootstrap(this.deps.client, this.deps.projectId)
        this.installAll(data.files)
    }

    /** Bulk replace the file set. Called by `ProjectBootstrap` once the
     *  editor-bootstrap fetch resolves. */
    installAll(files: readonly MapFile[]): void {
        const next = new Map<string, MapFile>()
        for (const f of files) next.set(f.path, f)
        this._byPath.value = next
    }

    /** Insert or update one file in the map. */
    upsert(file: MapFile): void {
        const next = new Map(this._byPath.peek())
        next.set(file.path, file)
        this._byPath.value = next
    }

    /** Remove one file from the map. */
    remove(path: string): void {
        const cur = this._byPath.peek()
        if (!cur.has(path)) return
        const next = new Map(cur)
        next.delete(path)
        this._byPath.value = next
    }

    get(path: string): MapFile | undefined {
        return this._byPath.peek().get(path)
    }

    has(path: string): boolean {
        return this._byPath.peek().has(path)
    }

    /** Move/rename: PUT to `newPath`, DELETE `oldPath`, repoint the flat
     *  map. Caller supplies the body + content type — typically the
     *  in-memory dirty text from `TextModelService`, falling back to
     *  whatever the editor read previously. The server has no atomic
     *  rename endpoint so this composes the two writes. */
    async rename(
        oldPath: string,
        newPath: string,
        body: string,
        contentType: string = 'text/plain',
    ): Promise<RenameResult> {
        if (oldPath === newPath) {
            const existing = this._byPath.peek().get(oldPath)
            return existing
                ? { ok: true, file: existing }
                : { ok: false, error: { kind: 'read', cause: new Error('missing') } }
        }
        if (this._byPath.peek().has(newPath)) {
            return { ok: false, error: { kind: 'exists' } }
        }
        let file: MapFile
        try {
            file = await v1MapFilesUpdate(
                this.deps.client,
                this.deps.projectId,
                newPath,
                body,
                contentType,
            )
        } catch (cause) {
            return { ok: false, error: { kind: 'write', cause } }
        }
        try {
            await v1MapFilesDelete(this.deps.client, this.deps.projectId, oldPath)
        } catch (cause) {
            // New path is already written; the old will be tidied by the
            // next refresh. Surface a warning but don't roll back —
            // matches the prior behavior.
            console.warn('[FileTreeService.rename] delete old failed', cause)
        }
        const next = new Map(this._byPath.peek())
        next.delete(oldPath)
        next.set(file.path, file)
        this._byPath.value = next
        return { ok: true, file }
    }

    /** Delete by path. Removes from the flat map after the server confirms. */
    async delete(path: string): Promise<DeleteResult> {
        try {
            await v1MapFilesDelete(this.deps.client, this.deps.projectId, path)
        } catch (cause) {
            return { ok: false, error: { kind: 'network', cause } }
        }
        this.remove(path)
        return { ok: true }
    }

    dispose(): void {
        this._byPath.value = new Map()
    }
}
