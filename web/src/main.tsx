import { createRoot } from 'react-dom/client'
import { Routes } from '@generouted/react-router'

import { AppRoot } from '@hollowcube/common'
import { createHashLaunchCodeSource } from '@hollowcube/common/auth'
import { createBrowserStorage } from '@hollowcube/common/platform'

import '@hollowcube/design-system/globals.css'

// Browser-history routing here, so the launch-code fragment (#code=…) doesn't
// collide with the router. Desktop omits this (hash routing + Phase 2 handoff).
//
// Dev hits Envoy directly at :10000 so the request origin == the DPoP `htu`
// the backend reconstructs (the Vite same-origin proxy would make htu :5173
// and every proof would 401). Prod is served from the real Envoy origin, so
// same-origin (no base) is correct there.
const platform = {
    kind: 'web' as const,
    storage: createBrowserStorage(),
    apiBaseUrl: import.meta.env.DEV ? 'http://localhost:10000' : undefined,
    launchCode: createHashLaunchCodeSource(),
}

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform} devTools={import.meta.env.DEV}>
        <Routes />
    </AppRoot>,
)
