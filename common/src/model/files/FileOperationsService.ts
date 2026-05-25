// `FileOperationsService` — orchestrates file rename / move / delete
// across the services they need to touch (file tree, text models, layout,
// pending files). The atomic primitives live on those services; this is
// the composition layer.
//
// Used to live as ~150 lines of useCallback closures in `files.tsx`.
// Lifting it here means the orchestration is testable without React, and
// the file browser becomes a thin view that calls one method per
// user-intent (rename / move / delete).

import { v1MapFilesGet, type HCClient } from '@hollowcube/api'

import type { Tab } from '../../workspace/types'
import type { TextModelService } from '../text-models/TextModelService'
import { findLeaf, selectTabLocations } from '../workspace/tree-helpers'
import type { WorkspaceLayoutService } from '../workspace/WorkspaceLayoutService'
import type { FileTreeService } from './FileTreeService'
import type { PendingFilesService } from './PendingFilesService'

const TEXT_EDITOR_KIND = 'editor:text'

export type FileMoveResult =
    | { ok: true }
    | {
          ok: false
          error:
              | { kind: 'exists' }
              | { kind: 'read'; cause: unknown }
              | { kind: 'write'; cause: unknown }
              | { kind: 'unknown'; cause: unknown }
      }

export type FileDeleteResult =
    | { ok: true }
    | { ok: false; error: { kind: 'network'; cause: unknown } }

export interface FileOperationsServiceDeps {
    projectId: string
    client: HCClient
    fileTree: FileTreeService
    pendingFiles: PendingFilesService
    textModels: TextModelService
    layout: WorkspaceLayoutService
}

export class FileOperationsService {
    constructor(private readonly deps: FileOperationsServiceDeps) {}

    /** Move or rename a file. `sourceId` is either a saved file path or
     *  a `pending:<tempId>` placeholder. Pending entries with no server
     *  state yet just have their path reassigned; real files PUT to the
     *  new path, DELETE the old, repoint open editor tabs and the
     *  in-memory `TextModel`. */
    async move(sourceId: string, newPath: string): Promise<FileMoveResult> {
        const { fileTree, pendingFiles, textModels, layout, client, projectId } = this.deps
        if (sourceId.startsWith('pending:')) {
            const tempId = sourceId.slice('pending:'.length)
            pendingFiles.assignPath(tempId, newPath)
            return { ok: true }
        }
        const oldPath = sourceId
        if (oldPath === newPath) return { ok: true }
        if (fileTree.has(newPath)) return { ok: false, error: { kind: 'exists' } }

        // Prefer the open TextModel's in-memory content (dirty edits
        // would be lost on a server GET). Fall back to the server when
        // the file isn't open in any tab.
        const openModel = textModels.get(oldPath)
        let body: string
        let contentType = 'text/plain'
        if (openModel) {
            body = openModel.content.peek()
        } else {
            try {
                const bytes = await v1MapFilesGet(client, projectId, oldPath)
                body = new TextDecoder('utf-8', { fatal: false }).decode(bytes.bytes)
                contentType = bytes.contentType || 'text/plain'
            } catch (cause) {
                return { ok: false, error: { kind: 'read', cause } }
            }
        }

        const result = await fileTree.rename(oldPath, newPath, body, contentType)
        if (!result.ok) {
            if (result.error.kind === 'exists') return { ok: false, error: { kind: 'exists' } }
            if (result.error.kind === 'write')
                return { ok: false, error: { kind: 'write', cause: result.error.cause } }
            return { ok: false, error: { kind: 'unknown', cause: result.error.cause } }
        }

        textModels.handleRename(oldPath, newPath)
        repointEditorTabsForRename(layout, oldPath, newPath)
        return { ok: true }
    }

    /** Delete a file. Closes any open editor tabs that reference it (or
     *  any path beneath it for a deleted folder) BEFORE the server call
     *  so the editor unmounts and cancels its pending autosave timer,
     *  avoiding a race where save would resurrect the file. */
    async delete(path: string): Promise<FileDeleteResult> {
        closeTabsForPath(this.deps.layout, path)
        const result = await this.deps.fileTree.delete(path)
        if (!result.ok) return result
        return { ok: true }
    }
}

function repointEditorTabsForRename(
    layout: WorkspaceLayoutService,
    oldPath: string,
    newPath: string,
): void {
    const state = layout.state.peek()
    const locations = selectTabLocations(state)
    const newTitle = newPath.split('/').pop() ?? newPath
    for (const [tabId, loc] of locations) {
        if (!loc || loc.kind !== 'editor') continue
        const leaf = findLeaf(state.center, loc.leafId)
        const tab = leaf?.tabs.find((t: Tab) => t.id === tabId)
        if (!tab || tab.kind !== TEXT_EDITOR_KIND) continue
        const tabPath = (tab.payload as { path?: string } | undefined)?.path
        if (tabPath !== oldPath) continue
        layout.updateTab(tabId, {
            title: newTitle,
            payload: { ...tab.payload, path: newPath },
        })
    }
}

function closeTabsForPath(layout: WorkspaceLayoutService, target: string): void {
    const state = layout.state.peek()
    const locations = selectTabLocations(state)
    const matches: { tabId: string; loc: ReturnType<typeof locations.get> }[] = []
    for (const [tabId, loc] of locations) {
        if (!loc || loc.kind !== 'editor') continue
        const leaf = findLeaf(state.center, loc.leafId)
        const tab = leaf?.tabs.find((t: Tab) => t.id === tabId)
        if (!tab || tab.kind !== TEXT_EDITOR_KIND) continue
        const tabPath = (tab.payload as { path?: string } | undefined)?.path
        if (!tabPath) continue
        if (tabPath === target || tabPath.startsWith(`${target}/`)) {
            matches.push({ tabId, loc })
        }
    }
    for (const { tabId, loc } of matches) {
        if (loc) layout.closeTab(loc, tabId)
    }
}

// Re-export for tests that want to assert on tab cleanup directly.
export { closeTabsForPath, repointEditorTabsForRename }
