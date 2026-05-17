import { type ReactNode } from 'react'

import { Button } from '@hollowcube/design-system'

import { usePlatform } from '../platform'
import { useAuth } from './context'
import { Launcher } from './launcher'

function Centered({ children }: { children: ReactNode }) {
    return (
        <div className='bg-background text-muted-foreground flex h-svh w-full flex-col items-center justify-center gap-3 p-6 text-center text-sm'>
            {children}
        </div>
    )
}

function formatError(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
}

// Blocks the workspace until an authenticated session is reachable. Scope is
// the `/` workspace only — demo/dev routes never mount this. Phase 1 stops at
// the authenticated state and renders the workspace children; there is no
// project/file work here.
export function AuthGate({ children }: { children: ReactNode }) {
    const { status, redeemFromLaunch } = useAuth()
    const platform = usePlatform()

    switch (status.kind) {
        case 'initializing':
            return <Centered>Starting up…</Centered>
        case 'redeeming':
            return <Centered>Signing you in…</Centered>
        case 'picking':
            return <Launcher />
        case 'authenticated':
            return children
        case 'error':
            return (
                <Centered>
                    <span className='text-destructive'>
                        Sign-in failed: {formatError(status.error)}
                    </span>
                    <Button variant='outline' size='sm' onClick={redeemFromLaunch}>
                        Try again
                    </Button>
                </Centered>
            )
        case 'unauthenticated':
            return (
                <Centered>
                    <span className='text-foreground text-base font-medium'>
                        Open the editor from in-game
                    </span>
                    <span>
                        {platform.kind === 'desktop'
                            ? 'Launch the editor from the in-game menu to sign in. No accounts are saved on this device yet.'
                            : 'Join the server and open the editor with the in-game command to sign in.'}
                    </span>
                </Centered>
            )
    }
}
