import { useEffect } from 'react'

import {
    AuthGate,
    getActiveProjectId,
    OpenFromGame,
    setActiveProjectId,
    useAuth,
} from '@hollowcube/common/auth'
import { usePlatform } from '@hollowcube/common/platform'
import { ProjectWorkspace, synthesizeProjectName } from '@hollowcube/common/project'

// Web reads the active project from sessionStorage (stashed per-tab). After a
// fresh redeem the AuthProvider surfaces the granted project via context — we
// persist it here so reloads in the same tab pick it up. A dev override
// always wins over both grant and storage.
function WebProjectShell() {
    const { grantedProject } = useAuth()
    const platform = usePlatform()
    const override = platform.devMapIdOverride ?? null
    const projectId = override ?? grantedProject ?? getActiveProjectId()

    useEffect(() => {
        if (projectId) setActiveProjectId(projectId)
    }, [projectId])

    useEffect(() => {
        if (projectId) platform.setWindowTitle(synthesizeProjectName(projectId))
    }, [platform, projectId])

    if (!projectId) return <OpenFromGame />
    return <ProjectWorkspace projectId={projectId} />
}

export default function Index() {
    return (
        <AuthGate>
            <WebProjectShell />
        </AuthGate>
    )
}
