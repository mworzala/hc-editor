import { createRoot } from 'react-dom/client'
import { Routes } from '@generouted/react-router'

import { AppRoot } from '@hollowcube/common'
import { createBrowserStorage } from '@hollowcube/common/platform'

import '@hollowcube/design-system/globals.css'

const platform = { kind: 'web' as const, storage: createBrowserStorage() }

createRoot(document.getElementById('root')!).render(
    <AppRoot platform={platform} devTools={import.meta.env.DEV}>
        <Routes />
    </AppRoot>,
)
