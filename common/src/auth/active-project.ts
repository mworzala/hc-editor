// Per-tab active project id (web-only).
//
// The in-game launch grant carries the project the tester opened from. On
// web we stash it in `sessionStorage` — deliberately NOT the URL, NOT
// IndexedDB, and NOT the workspace `Storage` abstraction:
//
//   • per-tab — two tabs (two in-game launches) target different projects
//     without colliding
//   • cleared on tab close — no resume-without-grant path; re-entry from
//     in-game re-establishes it each session
//   • reload survives — the same tab keeps its project across F5
//
// Desktop does NOT use this module. There the active project id lives in
// the URL (`/#/project/:projectId`) because the Go-side WindowManager opens
// each project in its own window with a distinct route — sessionStorage
// would be the wrong scope (one webview per window, not per project).

const KEY = 'hc-active-project'

export function setActiveProjectId(id: string | null): void {
    try {
        if (id) window.sessionStorage.setItem(KEY, id)
        else window.sessionStorage.removeItem(KEY)
    } catch {
        // sessionStorage disabled/unavailable — degrade to "no project",
        // which surfaces the "open from in-game" screen rather than crashing.
    }
}

export function getActiveProjectId(): string | null {
    try {
        return window.sessionStorage.getItem(KEY)
    } catch {
        return null
    }
}
