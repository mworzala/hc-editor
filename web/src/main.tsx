import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { routes } from '@generouted/react-router'

import { AppRoot } from '@hollowcube/common'
import { createHashLaunchCodeSource } from '@hollowcube/common/auth'
import { createBrowserStorage } from '@hollowcube/common/platform'

import { resolveApiBaseUrl } from './api-base'

import '@hollowcube/design-system/globals.css'

// Browser-history routing here, so the launch-code fragment (#code=…) doesn't
// collide with the router. Desktop omits this (hash routing + Phase 2 handoff).
//
// `apiBaseUrl` is resolved at runtime from the page hostname (web/src/api-base.ts),
// not baked in at build time, so one artifact serves prod / per-PR previews /
// the localhost-backend deployment. It is still always an absolute URL,
// cross-origin in prod (editor on hollowcube.net, API on api.hollowcube.net)
// and localhost in dev — there is no same-origin fallback, and an unrecognized
// host throws at load rather than guessing.
// Resolved once here at load — referentially stable for the page lifetime
// (the AuthProvider's HCClient useMemo depends on this not changing).
//
// Dev-only env overrides (all gated by import.meta.env.DEV so production
// builds tree-shake them out, regardless of what's set):
//   VITE_DEV_API_URL          — replaces the resolved api base
//   VITE_DEV_EDITOR_MAP_ID    — forces the active project (map) id
//   VITE_DEV_DUMMY_AUTH=true  — skip launch/redeem; requires the backend
//                               to be running with auth disabled
//   VITE_DEV_AUTH_USER        — stamp this id as `x-auth-user` on every
//                               request (pairs with the backend's
//                               auth-disabled mode)
const devApiUrl = import.meta.env.DEV
    ? (import.meta.env.VITE_DEV_API_URL?.trim() ?? '')
    : ''
const apiBaseUrl = devApiUrl || resolveApiBaseUrl(window.location.hostname)

const devMapIdOverride = import.meta.env.DEV
    ? (import.meta.env.VITE_DEV_EDITOR_MAP_ID?.trim() ?? '')
    : ''
const devDummyAuth = import.meta.env.DEV && import.meta.env.VITE_DEV_DUMMY_AUTH === 'true'
const devAuthUser = import.meta.env.DEV
    ? (import.meta.env.VITE_DEV_AUTH_USER?.trim() ?? '')
    : ''

const platform = {
    kind: 'web' as const,
    storage: createBrowserStorage(),
    apiBaseUrl,
    launchCode: createHashLaunchCodeSource(),
    devMapIdOverride: devMapIdOverride || undefined,
    devDummyAuth: devDummyAuth || undefined,
    devAuthUser: devAuthUser || undefined,
}

// generouted's <Routes> builds its own browser router with no basename, so it
// ignores Vite's `base`. Build the router ourselves from its exported route
// tree so client navigation works under the `/editor` subpath.
const basename = import.meta.env.BASE_URL.replace(/\/$/u, '') || '/'
const router = createBrowserRouter(routes, { basename })

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform} devTools={import.meta.env.DEV}>
        <RouterProvider router={router} />
    </AppRoot>,
)
