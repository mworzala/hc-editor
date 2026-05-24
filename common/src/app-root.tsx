import { StrictMode, useEffect, useRef, useState, type ReactNode } from 'react'
import { HotkeysProvider } from '@tanstack/react-hotkeys'

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
    children: ReactNode
}

export function AppRoot({ platform, children }: AppRootProps) {
    return (
        <StrictMode>
            <AppErrorBoundary>
                <PlatformProvider platform={platform}>
                    <AppBridge>
                        <HotkeysProvider>{children}</HotkeysProvider>
                    </AppBridge>
                </PlatformProvider>
            </AppErrorBoundary>
        </StrictMode>
    )
}

// Constructs the `EditorApp` (which builds the `AuthService` internally)
// once per platform identity and exposes it via `<AppProvider>`. The
// auth state machine + HCClient + DPoP plumbing live inside the service
// — there's no separate `<AuthProvider>` in the tree.
function AppBridge({ children }: { children: ReactNode }) {
    const platform = usePlatform()
    const appRef = useRef<EditorApp | null>(null)
    const [, forceRender] = useState(0)

    useEffect(() => {
        const app = new EditorApp({ platform })
        appRef.current = app
        forceRender((n) => n + 1)
        return () => {
            app.dispose()
            if (appRef.current === app) appRef.current = null
        }
    }, [platform])

    const app = appRef.current
    if (!app) return null
    return <AppProvider app={app}>{children}</AppProvider>
}
