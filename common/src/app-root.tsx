import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { AuthProvider, useAuth } from './auth'
import { QueryDevtoolsToggle } from './dev'
import { AppProvider, EditorApp } from './model'
import { PlatformProvider, usePlatform, type Platform } from './platform'
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
                        <AppBridge>
                            <QueryClientProvider client={client}>
                                <HotkeysProvider>
                                    {children}
                                    {devTools ? <QueryDevtoolsToggle /> : null}
                                </HotkeysProvider>
                            </QueryClientProvider>
                        </AppBridge>
                    </AuthProvider>
                </PlatformProvider>
            </AppErrorBoundary>
        </StrictMode>
    )
}

// Phase 1 of the model migration: construct the `EditorApp` once auth has
// produced an HCClient and expose it via `<AppProvider>`. Nothing consumes
// `useApp()` yet — the existing React tree continues to drive every visible
// behavior. Phase 5 will collapse this bridge: AppProvider moves above
// AuthProvider and AuthService is lifted onto EditorApp.
function AppBridge({ children }: { children: ReactNode }) {
    const platform = usePlatform()
    const { client } = useAuth()
    const appRef = useRef<EditorApp | null>(null)
    const [, forceRender] = useState(0)

    // Construct on mount; rebuild only if the client identity changes
    // (HMR or dev-dummy toggle). Disposal on unmount tears down the
    // current project, if any.
    useEffect(() => {
        const app = new EditorApp({ platform, client })
        appRef.current = app
        forceRender((n) => n + 1)
        return () => {
            app.dispose()
            if (appRef.current === app) appRef.current = null
        }
    }, [platform, client])

    const app = appRef.current
    if (!app) return null
    return <AppProvider app={app}>{children}</AppProvider>
}

let sharedQueryClient: QueryClient | null = null
function defaultQueryClient(): QueryClient {
    if (!sharedQueryClient) sharedQueryClient = new QueryClient()
    return sharedQueryClient
}
