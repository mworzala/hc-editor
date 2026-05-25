import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { routes } from '@generouted/react-router'
import { Window } from '@wailsio/runtime'

import { AppRoot } from '@hollowcube/common'
import { createBrowserStorage } from '@hollowcube/common/platform'

import { desktopMenuController } from './menu-bridge'

import '@hollowcube/design-system/globals.css'
import './style.css'

const router = createHashRouter(routes)

// Dev-only env overrides (all gated by import.meta.env.DEV so production
// builds tree-shake them out, regardless of what's set):
//   VITE_DEV_API_URL          — replaces the default api base
//   VITE_DEV_EDITOR_MAP_ID    — forces the active project (map) id
//   VITE_DEV_DUMMY_AUTH=true  — skip launch/redeem; requires the backend
//                               to be running with auth disabled
//   VITE_DEV_AUTH_USER        — stamp this id as `x-auth-user` on every
//                               request (pairs with the backend's
//                               auth-disabled mode)
const devApiUrl = import.meta.env.DEV ? (import.meta.env.VITE_DEV_API_URL?.trim() ?? '') : ''
const devMapIdOverride = import.meta.env.DEV
    ? (import.meta.env.VITE_DEV_EDITOR_MAP_ID?.trim() ?? '')
    : ''
const devDummyAuth = import.meta.env.DEV && import.meta.env.VITE_DEV_DUMMY_AUTH === 'true'
const devAuthUser = import.meta.env.DEV ? (import.meta.env.VITE_DEV_AUTH_USER?.trim() ?? '') : ''

const platform = {
    kind: 'desktop' as const,
    storage: createBrowserStorage(),
    setWindowTitle: (title: string) => Window.SetTitle(title),
    // Absolute URL to Envoy: also bypasses the `wails://` custom-scheme
    // handler (WKURLSchemeHandler drops HTTP bodies — WebKit bug 192315). The
    // request origin == the DPoP `htu` the backend reconstructs.
    apiBaseUrl: devApiUrl || 'http://localhost:10000',
    menu: desktopMenuController,
    // No `launchCode` source today: desktop uses hash routing (reading
    // `location.hash` would collide with the router) and the web→native
    // handoff isn't built yet — a Wails deep-link event will supply a
    // LaunchCodeSource here when it lands.
    devMapIdOverride: devMapIdOverride || undefined,
    devDummyAuth: devDummyAuth || undefined,
    devAuthUser: devAuthUser || undefined,
}

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform}>
        <RouterProvider router={router} />
    </AppRoot>,
)
