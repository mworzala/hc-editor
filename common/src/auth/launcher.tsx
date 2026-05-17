import { LogOutIcon } from 'lucide-react'

import { Button } from '@hollowcube/design-system'

import { useAuth } from './context'

function initials(label: string): string {
    const parts = label.trim().split(/\s+/u)
    return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

// Account picker shown when one or more stored sessions exist but none is
// active. Selecting an account mints its access token (→ workspace) or, if
// the session needs re-auth, surfaces that state.
export function Launcher() {
    const { sessions, switchAccount, signOut } = useAuth()

    return (
        <div className='bg-background flex h-svh w-full items-center justify-center p-6'>
            <div className='flex w-full max-w-sm flex-col gap-4'>
                <div className='text-center'>
                    <h1 className='text-foreground text-lg font-medium'>Choose an account</h1>
                    <p className='text-muted-foreground mt-1 text-sm'>
                        Pick a signed-in account to continue.
                    </p>
                </div>
                <ul className='flex flex-col gap-2'>
                    {sessions.map((s) => {
                        const label = s.accountMeta.username || s.accountMeta.id
                        const needsReauth = s.state === 'needs-reauth'
                        return (
                            <li
                                key={s.account}
                                className='border-border flex items-center gap-3 rounded-md border p-2'
                            >
                                <button
                                    type='button'
                                    onClick={() => void switchAccount(s.account)}
                                    className='hover:bg-accent flex min-w-0 flex-1 items-center gap-3 rounded p-1 text-left'
                                >
                                    <span className='bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium'>
                                        {initials(label)}
                                    </span>
                                    <span className='flex min-w-0 flex-col'>
                                        <span className='text-foreground truncate text-sm font-medium'>
                                            {label}
                                        </span>
                                        <span className='text-muted-foreground truncate text-xs'>
                                            {needsReauth
                                                ? 'Session expired — sign in again'
                                                : s.account}
                                        </span>
                                    </span>
                                </button>
                                <Button
                                    variant='ghost'
                                    size='icon-sm'
                                    aria-label={`Sign out ${label}`}
                                    onClick={() => void signOut(s.account)}
                                >
                                    <LogOutIcon />
                                </Button>
                            </li>
                        )
                    })}
                </ul>
                <Button variant='outline' size='sm' onClick={() => void signOut('all')}>
                    Sign out of all accounts
                </Button>
            </div>
        </div>
    )
}
