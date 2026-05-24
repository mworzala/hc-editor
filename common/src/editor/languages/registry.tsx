import { type LanguageDefinition } from './types'

// The canonical language registry is `LanguageService` in
// `common/src/model/languages/`. The pure-TS lookup helpers below stay
// here because the editor language modules (luau-editor-services etc.)
// and tests reference them directly without going through the model layer.

/** Plain (React-free) language lookup by mime type. First match wins.
 *  Supports `<type>/*` wildcard patterns in `LanguageDefinition.mimeTypes`. */
export function resolveLanguageForMime(
    languages: readonly LanguageDefinition[],
    mimeType: string | undefined,
): LanguageDefinition | undefined {
    if (!mimeType) return undefined
    return languages.find((l) => l.mimeTypes.some((p) => matchesMime(p, mimeType)))
}

/** Plain (React-free) language lookup by file path. Match is by file
 *  extension (case-insensitive) against `LanguageDefinition.extensions`. */
export function resolveLanguageForPath(
    languages: readonly LanguageDefinition[],
    path: string | undefined,
): LanguageDefinition | undefined {
    if (!path) return undefined
    const dot = path.lastIndexOf('.')
    if (dot === -1) return undefined
    const ext = path.slice(dot).toLowerCase()
    return languages.find((l) => l.extensions.includes(ext))
}

function matchesMime(pattern: string, mime: string): boolean {
    if (pattern === mime) return true
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1)
        return mime.startsWith(prefix)
    }
    return false
}

/** Inspect every registered language's mime types — used by host code that
 *  needs to decide whether a file is openable as text without a React hook. */
export function listAllLanguageMimes(languages: readonly LanguageDefinition[]): string[] {
    const out: string[] = []
    for (const l of languages) for (const m of l.mimeTypes) out.push(m)
    return out
}
