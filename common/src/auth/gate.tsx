import { type ReactNode } from 'react'

import { Button } from '@hollowcube/design-system'

import { useAuth } from '../model/auth/react'
import { IndexedDbUnavailableError } from '../model/auth/idb'
import { usePlatform } from '../platform'
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

// Shown when there is no session at all (web fallback) or when an
// authenticated session is present but no project context is available
// (web tab without grant). The only way in is a fresh in-game launch.
// Desktop replaces this with the launcher window — see desktop/frontend.
export function OpenFromGame() {
    const platform = usePlatform()
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

// Blocks rendering until an authenticated session is reachable. The
// project-id check has moved to the page shell — desktop reads the id from
// the URL, web reads it from sessionStorage and falls back to OpenFromGame.
export function AuthGate({ children }: { children: ReactNode }) {
    const { status, redeemFromLaunch } = useAuth()

    switch (status.kind) {
        case 'initializing':
            return <Centered>Starting up…</Centered>
        case 'redeeming':
            return <Centered>Signing you in…</Centered>
        case 'picking':
            return <Launcher />
        case 'authenticated':
            return <>{children}</>
        case 'error':
            // IndexedDB-unavailable deterministically re-fails, so "Try
            // again" (re-run redeem) is a dead end — offer a reload after the
            // user fixes their browser settings instead.
            if (status.error instanceof IndexedDbUnavailableError) {
                return (
                    <Centered>
                        <span className='text-destructive'>{status.error.message}</span>
                        <Button
                            variant='outline'
                            size='sm'
                            onClick={() => window.location.reload()}
                        >
                            Reload
                        </Button>
                    </Centered>
                )
            }
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
            return <OpenFromGame />
    }
}
