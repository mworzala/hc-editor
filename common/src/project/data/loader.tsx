import { type ReactNode } from 'react'

import { useV1ProjectGet } from '@hollowcube/api'

import { ProjectStateProvider, useProjectState } from '../context'

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
    const { data, error, status } = useV1ProjectGet(projectId)

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
        <ProjectStateProvider state={{ status: 'loaded', project: data }}>
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
