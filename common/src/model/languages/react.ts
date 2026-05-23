import type { LanguageDefinition } from '../../editor/languages/types'
import { useProject } from '../foundation/react'

export function useLanguageService() {
    return useProject().languages
}

export function useLanguages(): readonly LanguageDefinition[] {
    return useProject().languages.languages
}

export function useLanguageById(id: string | undefined): LanguageDefinition | undefined {
    return useProject().languages.byId(id)
}

export function useLanguageForMime(mimeType: string | undefined): LanguageDefinition | undefined {
    return useProject().languages.byMime(mimeType)
}

export function useLanguageForPath(path: string | undefined): LanguageDefinition | undefined {
    return useProject().languages.byPath(path)
}
