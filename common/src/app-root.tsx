import { StrictMode, type ReactNode } from 'react'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AuthProvider } from './auth'
import { QueryDevtoolsToggle } from './dev'
import { PlatformProvider, type Platform } from './platform'
import { AppErrorBoundary } from './project'

// Shared provider tree for both the web SPA shell and the Wails desktop
// frontend. Each shell calls `<AppRoot>` once at the very top of its tree;
// everything below (routing, page components) is identical across platforms.
//
// Platform-specific concerns enter through:
//
//   • `platform` — concrete Platform impl (web/desktop). The shell builds it
//     and hands it in.
//   • `children` — the platform's routing root (e.g. <Routes /> on web,
//     <RouterProvider router={...} /> on desktop).

type AppRootProps = {
    platform: Platform
    queryClient?: QueryClient
    children: ReactNode
    /** Mount the TanStack Query devtools toggle. The shell decides — typically
     *  `import.meta.env.DEV` from its Vite config. Off by default so this
     *  module doesn't depend on Vite's env types. */
    devTools?: boolean
}

export function AppRoot({ platform, queryClient, children, devTools = false }: AppRootProps) {
    const client = queryClient ?? defaultQueryClient()
    return (
        <StrictMode>
            <AppErrorBoundary>
                <PlatformProvider platform={platform}>
                    <AuthProvider>
                        <QueryClientProvider client={client}>
                            <HotkeysProvider>
                                {children}
                                {devTools ? <QueryDevtoolsToggle /> : null}
                            </HotkeysProvider>
                        </QueryClientProvider>
                    </AuthProvider>
                </PlatformProvider>
            </AppErrorBoundary>
        </StrictMode>
    )
}

let sharedQueryClient: QueryClient | null = null
function defaultQueryClient(): QueryClient {
    if (!sharedQueryClient) sharedQueryClient = new QueryClient()
    return sharedQueryClient
}
