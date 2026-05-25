import { useCallback, useState } from 'react'

import { OpenProject } from '../../bindings/changeme/windowmanager'
import { ProjectList } from './ProjectList'
import type { LauncherProject } from './projects'
import { useProjects } from './useProjects'

export function Launcher() {
    const projects = useProjects()
    const [opening, setOpening] = useState<string | null>(null)

    const handleOpen = useCallback(async (project: LauncherProject) => {
        setOpening(project.id)
        try {
            await OpenProject(project.id, project.name)
        } catch (err) {
            console.error('[launcher] OpenProject failed', err)
            setOpening(null)
        }
        // No reset on success: the launcher window closes when the editor
        // window opens.
    }, [])

    return (
        <div
            className='bg-background text-foreground flex h-svh w-full flex-col'
            // macOS: top inset is drag-region so the user can move the
            // launcher by the title bar even though there's no React-side
            // chrome here.
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
            <header className='shrink-0 px-6 pt-12 pb-4'>
                <h1 className='text-foreground text-lg font-medium'>Open a project</h1>
                <p className='text-muted-foreground text-sm'>
                    Pick a project to open in a new window.
                </p>
            </header>
            <main
                className='min-h-0 flex-1 overflow-y-auto px-3 pb-6'
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
                <ProjectList projects={projects} onOpen={handleOpen} disabled={opening !== null} />
            </main>
        </div>
    )
}
