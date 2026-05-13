import { createContext, useContext, type ReactNode } from 'react'

import { type Project } from '@hollowcube/api'

// Project state is modeled as a small discriminated union so the workspace
// can render loading / error fallbacks coherently. Static use (demo, tests)
// goes through <ProjectProvider project={...}> which is just a shortcut for
// `{ status: 'loaded', project }`. API-driven use goes through `ProjectLoader`
// in ./data/loader.

export type ProjectState =
    | { status: 'loading' }
    | { status: 'error'; error: unknown }
    | { status: 'loaded'; project: Project }

export type { Project }

const ProjectStateContext = createContext<ProjectState | null>(null)

export function ProjectStateProvider({
    state,
    children,
}: {
    state: ProjectState
    children: ReactNode
}) {
    return <ProjectStateContext.Provider value={state}>{children}</ProjectStateContext.Provider>
}

/** Shortcut for "I already have the project object" use sites (demos, tests). */
export function ProjectProvider({ project, children }: { project: Project; children: ReactNode }) {
    return (
        <ProjectStateProvider state={{ status: 'loaded', project }}>
            {children}
        </ProjectStateProvider>
    )
}

export function useProjectState(): ProjectState {
    const ctx = useContext(ProjectStateContext)
    if (!ctx) {
        throw new Error('useProjectState must be used inside a <ProjectProvider>')
    }
    return ctx
}

/** Returns the loaded project. Throws if the project is still loading or has
 *  errored — wrap the call site with a state check or render <ProjectGate>
 *  upstream of any consumer. */
export function useProject(): Project {
    const state = useProjectState()
    if (state.status !== 'loaded') {
        throw new Error(`useProject() called while project is ${state.status}`)
    }
    return state.project
}
