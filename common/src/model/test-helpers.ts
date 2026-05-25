// Small helpers for service-level tests. Live under model/ because they
// only depend on model-layer primitives — no React, no JSDOM, just enough
// glue to construct a small graph of real services.

import { createMemoryStorage } from '../platform'
import type { EditorGroupNode, Tab, WorkspaceState } from '../workspace/types'
import { ActionRegistry } from './actions/ActionRegistry'
import { ActiveEditorRegistry } from './active-editor/ActiveEditorRegistry'
import { ContextService } from './context/ContextService'
import { DialogService } from './dialogs/DialogService'
import { SearchService } from './search/SearchService'
import { WorkspaceLayoutService } from './workspace/WorkspaceLayoutService'

function leaf(id: string, tabs: Tab[] = [], activeId: string | null = null): EditorGroupNode {
    return { kind: 'leaf', id, tabs, activeId }
}

export function makeTestWorkspaceState(centerLeafId = 'leaf-1'): WorkspaceState {
    return {
        columnSizes: [22, 78, 0],
        middleSizes: [100, 0],
        docksVisible: { left: true, right: false, bottom: false },
        left: { tabs: [], activeId: null },
        right: { tabs: [], activeId: null },
        bottom: { tabs: [], activeId: null },
        center: leaf(centerLeafId),
        focusedLeafId: centerLeafId,
    }
}

/** Construct the common collaborators a service test usually needs:
 *  context + actions + activeEditor + layout + dialogs + search. Each
 *  caller owns disposal via the returned `dispose()` helper.
 *
 *  Pass `initialState` to seed a non-default layout (split centers,
 *  pre-populated tabs); defaults to a single empty center leaf. */
export function makeTestCollaborators(opts?: { initialState?: WorkspaceState }) {
    const context = new ContextService()
    const actions = new ActionRegistry({ context })
    const activeEditor = new ActiveEditorRegistry()
    const dialogs = new DialogService()
    const search = new SearchService({ actions })
    const layout = new WorkspaceLayoutService({
        storage: createMemoryStorage(),
        storageKey: 'test:layout',
        initialState: opts?.initialState ?? makeTestWorkspaceState(),
        persistDebounceMs: 0,
    })
    return {
        context,
        actions,
        activeEditor,
        dialogs,
        search,
        layout,
        dispose() {
            layout.dispose()
            search.dispose()
            dialogs.dispose()
            activeEditor.dispose()
            actions.dispose()
            context.dispose()
        },
    }
}
