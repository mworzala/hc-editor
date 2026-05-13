import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import { routes } from '@generouted/react-router'

import { AppRoot } from '@hollowcube/common'
import { createBrowserStorage } from '@hollowcube/common/platform'

import { desktopApiTransport } from './api-bridge'

import '@hollowcube/design-system/globals.css'
import './style.css'

const router = createHashRouter(routes)
const platform = {
    kind: 'desktop' as const,
    storage: createBrowserStorage(),
    apiTransport: desktopApiTransport,
}

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform} devTools={import.meta.env.DEV}>
        <RouterProvider router={router} />
    </AppRoot>,
)
