import { Outlet } from 'react-router'

export default function App() {
    return (
        <div className='min-h-svh bg-background text-foreground'>
            <Outlet />
        </div>
    )
}
