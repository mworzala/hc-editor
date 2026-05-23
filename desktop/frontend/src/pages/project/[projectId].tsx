import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'

import { AuthGate } from '@hollowcube/common/auth'
import { usePlatform } from '@hollowcube/common/platform'
import { ProjectWorkspace, synthesizeProjectName } from '@hollowcube/common/project'

export default function ProjectPage() {
    const { projectId } = useParams<{ projectId: string }>()
    const platform = usePlatform()

    useEffect(() => {
        if (!projectId) return
        platform.setWindowTitle(synthesizeProjectName(projectId))
    }, [platform, projectId])

    if (!projectId) return <Navigate to='/launcher' replace />

    return (
        <AuthGate>
            <ProjectWorkspace projectId={projectId} />
        </AuthGate>
    )
}
