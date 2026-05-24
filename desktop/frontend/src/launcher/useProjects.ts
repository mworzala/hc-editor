import { useMemo } from 'react'

import { usePlatform } from '@hollowcube/common/platform'
import { synthesizeProjectName } from '@hollowcube/common/project'

import { type LauncherProject } from './projects'

// Today: surface only the dev-override project. Production builds will read
// the override as undefined (env vars are tree-shaken by Vite when DEV=false)
// and the launcher renders its empty state.
//
// Coming: multiplex a project-list endpoint across every authenticated
// account and merge results here.
export function useProjects(): LauncherProject[] {
    const platform = usePlatform()
    return useMemo(() => {
        const override = platform.devMapIdOverride
        if (!override) return []
        return [{ id: override, name: synthesizeProjectName(override) }]
    }, [platform.devMapIdOverride])
}
