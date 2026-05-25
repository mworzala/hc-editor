// `useAuth()` — thin reader hook over the model-layer `AuthService`.
// Replaces the React-context-based `AuthContextValue` provider from
// `common/src/auth/context.tsx`. The exposed shape is identical so
// existing consumers (`AuthGate`, `Launcher`, web/desktop page shells
// reading `grantedProject`) don't need rewrites.

import type { HCClient } from '@hollowcube/api'

import { useSignal } from '../foundation/react'
import { useApp } from '../foundation/react'
import type { AuthStatus, Session } from './types'

export interface AuthContextValue {
    status: AuthStatus
    sessions: readonly Session[]
    activeAccount: string | null
    grantedProject: string | null
    client: HCClient
    redeemFromLaunch(): void
    switchAccount(account: string): Promise<void>
    signOut(target: string | 'all'): Promise<void>
}

export function useAuth(): AuthContextValue {
    const auth = useApp().auth
    const status = useSignal(auth.status)
    const sessions = useSignal(auth.sessions)
    const activeAccount = useSignal(auth.activeAccount)
    const grantedProject = useSignal(auth.grantedProject)
    return {
        status,
        sessions,
        activeAccount,
        grantedProject,
        client: auth.client,
        redeemFromLaunch: () => {
            void auth.redeemFromLaunch()
        },
        switchAccount: (account) => auth.switchAccount(account),
        signOut: (target) => auth.signOut(target),
    }
}
