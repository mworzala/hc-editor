import { useEffect, useMemo, type ReactNode } from 'react'

import { useV1MapEditorBootstrap } from '@hollowcube/api'

import { usePlatform } from '../../platform'
import { ProjectStateProvider, useProjectState, type Project } from '../context'

// API-driven project loader. Fetches the project via the HCClient injected
// through `<HCClientProvider>` upstream, threads the result through
// `<ProjectStateProvider>`, and renders an optional fallback while loading
// or on error.
//
// Usage:
//   <HCClientProvider client={client}>
//     <ProjectLoader
//       projectId="..."
//       loading={<Spinner />}
//       errored={(err) => <ErrorPanel error={err} />}
//     >
//       <ProjectWorkspace />
//     </ProjectLoader>
//   </HCClientProvider>

type ProjectLoaderProps = {
    projectId: string
    loading?: ReactNode
    errored?: (error: unknown) => ReactNode
    children: ReactNode
}

export function ProjectLoader({ projectId, loading, errored, children }: ProjectLoaderProps) {
    const { data, error, status } = useV1MapEditorBootstrap(projectId)

    // Flatten the editor-bootstrap response into the app-shell view-model.
    const project = useMemo<Project | undefined>(
        () =>
            data
                ? {
                      id: data.map.id,
                      name: data.map.name,
                      owner: data.map.owner,
                      files: data.files,
                  }
                : undefined,
        [data],
    )

    // Always update the window title to match the map name.
    const platform = usePlatform()
    useEffect(() => {
        if (project?.name) platform.setWindowTitle(project.name)
    }, [project?.name, platform])

    if (status === 'pending') {
        return (
            <ProjectStateProvider state={{ status: 'loading' }}>
                {loading ?? null}
            </ProjectStateProvider>
        )
    }
    if (status === 'error') {
        return (
            <ProjectStateProvider state={{ status: 'error', error }}>
                {errored?.(error) ?? null}
            </ProjectStateProvider>
        )
    }
    return (
        <ProjectStateProvider state={{ status: 'loaded', project: project! }}>
            {children}
        </ProjectStateProvider>
    )
}

/** Convenience: render different content per project state. Useful when
 *  consumers want a single switch without manually unpacking `useProjectState`. */
export function ProjectGate({
    loading,
    errored,
    children,
}: {
    loading?: ReactNode
    errored?: (error: unknown) => ReactNode
    children: ReactNode
}) {
    const state = useProjectState()
    if (state.status === 'loading') return loading ?? null
    if (state.status === 'error') return errored?.(state.error) ?? null
    return children
}
