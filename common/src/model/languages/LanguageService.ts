// `LanguageService` — language registry + mime/path/id lookup.
// Replaces `<LanguageProvider>`. The lookup logic (mime wildcards,
// case-insensitive extension matching) is copied verbatim from the old
// `common/src/editor/languages/registry.tsx` so consumers see identical
// behavior.
//
// No async state, no signals — the registry is constructed once with a
// fixed array and never changes. The signal layer (`react.ts`) wraps the
// service for React subscriptions but the array itself is immutable.

import type { LanguageDefinition } from '../../editor/languages/types'

export class LanguageService {
    readonly languages: readonly LanguageDefinition[]

    constructor(languages: readonly LanguageDefinition[]) {
        this.languages = languages
    }

    byId(id: string | undefined): LanguageDefinition | undefined {
        if (!id) return undefined
        return this.languages.find((l) => l.id === id)
    }

    byMime(mimeType: string | undefined): LanguageDefinition | undefined {
        if (!mimeType) return undefined
        return this.languages.find((l) => l.mimeTypes.some((p) => matchesMime(p, mimeType)))
    }

    byPath(path: string | undefined): LanguageDefinition | undefined {
        if (!path) return undefined
        const dot = path.lastIndexOf('.')
        if (dot === -1) return undefined
        const ext = path.slice(dot).toLowerCase()
        return this.languages.find((l) => l.extensions.includes(ext))
    }

    /** Every mime type across the registry, in declaration order, with
     *  duplicates preserved (matches the legacy helper). Used by
     *  `isTextContentType` callers to decide whether a file is openable
     *  as text without subscribing to anything. */
    allMimes(): string[] {
        const out: string[] = []
        for (const l of this.languages) for (const m of l.mimeTypes) out.push(m)
        return out
    }

    dispose(): void {
        // No-op; languages are static.
    }
}

function matchesMime(pattern: string, mime: string): boolean {
    if (pattern === mime) return true
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -1)
        return mime.startsWith(prefix)
    }
    return false
}
