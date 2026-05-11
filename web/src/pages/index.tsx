import { Button } from '@hollowcube/design-system/components/button'
import { useHotkey } from '@tanstack/react-hotkeys'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { create } from 'zustand'

type CounterStore = {
    count: number
    increment: () => void
}

const useCounter = create<CounterStore>((set) => ({
    count: 0,
    increment: () => set((s) => ({ count: s.count + 1 })),
}))

export default function Home() {
    const { count, increment } = useCounter()
    const [lastHotkey, setLastHotkey] = useState<string | null>(null)

    useHotkey('Mod+K', () => setLastHotkey('Mod+K fired'))
    useHotkey('Mod+S', (event) => {
        event.preventDefault()
        setLastHotkey('Mod+S fired')
    })

    const { data: pingTime } = useQuery({
        queryKey: ['ping'],
        queryFn: async () => {
            await new Promise((r) => setTimeout(r, 200))
            return new Date().toISOString()
        },
    })

    return (
        <div className='flex min-h-svh items-center justify-center p-6'>
            <div className='flex max-w-md flex-col gap-4 text-sm leading-loose'>
                <h1 className='text-2xl font-medium'>Hollowcube Web</h1>
                <p className='text-muted-foreground'>
                    Vite + Generouted + Tanstack Query + Tanstack Hotkeys + Zustand
                </p>

                <div className='flex flex-wrap gap-2'>
                    <Button onClick={increment}>Count: {count}</Button>
                    <Link to='/ds'>
                        <Button variant='outline'>Design system →</Button>
                    </Link>
                    <Link to='/editor'>
                        <Button variant='outline'>Code editor →</Button>
                    </Link>
                    <Link to='/workspace'>
                        <Button variant='outline'>Workspace →</Button>
                    </Link>
                </div>

                <div className='font-mono text-xs text-muted-foreground'>
                    <div>Tanstack Query ping: {pingTime ?? 'loading…'}</div>
                    <div>Last hotkey: {lastHotkey ?? 'press Mod+K or Mod+S'}</div>
                </div>
            </div>
        </div>
    )
}
