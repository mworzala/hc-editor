// The React layer for the model. The entire React surface of the model
// is contained here:
//   - `useSignal` — bridge a ReadonlySignal to React state via
//     `useSyncExternalStore`.
//   - `<AppProvider>` / `useApp()` — exposes the top-level `EditorApp`.
//   - `<ProjectProvider>` / `useProject()` — exposes the per-project
//     `Project` container; throws if read outside its provider.
//
// This is the ONLY file under `common/src/model/**` that imports React.
// The oxlint override at the repo root exempts files named `react.ts` /
// `react.tsx` under `common/src/model/**` from the React-import ban.

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

import type { ReadonlySignal } from './signal'

import type { EditorApp } from '../EditorApp'
import type { Project } from '../Project'

const AppContext = createContext<EditorApp | null>(null)

export function AppProvider({ app, children }: { app: EditorApp; children: ReactNode }) {
    return <AppContext.Provider value={app}>{children}</AppContext.Provider>
}

export function useApp(): EditorApp {
    const app = useContext(AppContext)
    if (!app) throw new Error('useApp must be used inside an <AppProvider>')
    return app
}

const ProjectContext = createContext<Project | null>(null)

export function ProjectProvider({ project, children }: { project: Project; children: ReactNode }) {
    return <ProjectContext.Provider value={project}>{children}</ProjectContext.Provider>
}

export function useProject(): Project {
    const project = useContext(ProjectContext)
    if (!project) throw new Error('useProject must be used inside a <ProjectProvider>')
    return project
}

/** Subscribe a React component to a signal. Re-renders when the signal's
 *  value changes; identity-stable across renders so it plays nicely with
 *  React 18+ concurrent mode. */
export function useSignal<T>(s: ReadonlySignal<T>): T {
    return useSyncExternalStore(
        (cb) => s.subscribe(cb),
        () => s.value,
        () => s.value,
    )
}
