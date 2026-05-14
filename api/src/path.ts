export function encodeProjectId(projectId: string): string {
    return encodeURIComponent(projectId)
}

export function encodeWildcardPath(path: string): string {
    const trimmed = path.replace(/^\/+/u, '')
    return trimmed
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')
}

export function projectPath(projectId: string): `/${string}` {
    return `/v1/projects/${encodeProjectId(projectId)}`
}

export function projectFilePath(projectId: string, path: string): `/${string}` {
    return `/v1/projects/${encodeProjectId(projectId)}/files/${encodeWildcardPath(path)}`
}

export function projectEventsPath(projectId: string): `/${string}` {
    return `/v1/projects/${encodeProjectId(projectId)}/events`
}
