import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { routes } from '@generouted/react-router'
import { Window } from '@wailsio/runtime'

import { AppRoot } from '@hollowcube/common'
import { createBrowserStorage, type WindowControls } from '@hollowcube/common/platform'

import { desktopMenuController } from './menu-bridge'

import '@hollowcube/design-system/globals.css'
import './style.css'

const router = createHashRouter(routes)
const platform = {
    kind: 'desktop' as const,
    storage: createBrowserStorage(),
    window: {
        setTitle: Window.SetTitle,
        minimize: Window.Minimise,
        toggleFullScreen: Window.ToggleFullscreen,
        close: Window.Close,
    } satisfies WindowControls,
    // Absolute URL to Envoy: also bypasses the `wails://` custom-scheme
    // handler (WKURLSchemeHandler drops HTTP bodies — WebKit bug 192315). The
    // request origin == the DPoP `htu` the backend reconstructs.
    apiBaseUrl: 'http://localhost:10000',
    menu: desktopMenuController,
    // No `launchCode` source in Phase 1: desktop uses hash routing (reading
    // `location.hash` would collide with the router) and the web→native
    // handoff is Phase 2 — a Wails deep-link event will supply a
    // LaunchCodeSource here then.
}

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform} devTools={import.meta.env.DEV}>
        <RouterProvider router={router} />
    </AppRoot>,
)
