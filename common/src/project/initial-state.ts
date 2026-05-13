import { makeId, type WorkspaceState } from '../workspace'
import { WELCOME_EDITOR_KIND } from './editors/welcome'
import { FILES_TOOL_KIND } from './tools/files'

/** Default workspace state for a freshly opened project. Left dock visible with
 *  the Files tool active; bottom and right hidden until the user toggles them
 *  on. Center is a single leaf with the Welcome tab. */
export function createInitialWorkspaceState(): WorkspaceState {
    const filesTabId = makeId('tab')
    const welcomeTabId = makeId('tab')
    const centerLeafId = makeId('leaf')
    return {
        columnSizes: [22, 78, 0],
        middleSizes: [100, 0],
        docksVisible: { left: true, right: false, bottom: false },
        left: {
            tabs: [{ id: filesTabId, kind: FILES_TOOL_KIND, title: 'Files' }],
            activeId: filesTabId,
        },
        right: { tabs: [], activeId: null },
        bottom: { tabs: [], activeId: null },
        center: {
            kind: 'leaf',
            id: centerLeafId,
            tabs: [{ id: welcomeTabId, kind: WELCOME_EDITOR_KIND, title: 'Welcome' }],
            activeId: welcomeTabId,
        },
        focusedLeafId: centerLeafId,
    }
}
