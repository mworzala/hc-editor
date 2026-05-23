// Synthesizes a friendly display name from a project id. The eventual
// project list endpoint will return real names — this is the placeholder
// used by window titles and the desktop launcher until then.
export function synthesizeProjectName(id: string): string {
    return `Dev Project (${id})`
}
