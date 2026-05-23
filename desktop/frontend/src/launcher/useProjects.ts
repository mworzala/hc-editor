import { useMemo } from 'react'

import { usePlatform } from '@hollowcube/common/platform'
import { synthesizeProjectName } from '@hollowcube/common/project'

import { type LauncherProject } from './projects'

// Phase 1: surface only the dev-override project. Production builds will read
// the override as undefined (env vars are tree-shaken by Vite when DEV=false)
// and the launcher will render its empty state.
//
// Future phases: multiplex a project-list endpoint across every authenticated
// account and merge results here.
export function useProjects(): LauncherProject[] {
    const platform = usePlatform()
    return useMemo(() => {
        const override = platform.devMapIdOverride
        if (!override) return []
        return [{ id: override, name: synthesizeProjectName(override) }]
    }, [platform.devMapIdOverride])
}
