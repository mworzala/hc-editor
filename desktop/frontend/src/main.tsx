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
    // Bypass the `wails://` custom-scheme handler — WKURLSchemeHandler drops
    // HTTP bodies (WebKit bug 192315), so saves came through empty. Hitting
    // the Go server directly avoids it; the server allows CORS for this app.
    apiBaseUrl: 'http://127.0.0.1:9127',
    menu: desktopMenuController,
}

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform} devTools={import.meta.env.DEV}>
        <RouterProvider router={router} />
    </AppRoot>,
)
