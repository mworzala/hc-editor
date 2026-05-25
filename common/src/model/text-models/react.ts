import { useSignal } from '../foundation/react'
import { useProject } from '../foundation/react'
import type { DocumentId, TextModel } from './TextModel'

export function useTextModels() {
    return useProject().textModels
}

export function useTextModel(docId: DocumentId | undefined): TextModel | undefined {
    const svc = useProject().textModels
    if (!docId) return undefined
    return svc.get(docId)
}

export function useTextModelContent(docId: DocumentId | undefined): string {
    const model = useTextModel(docId)
    return useSignalOrEmpty(model?.content)
}

export function useAnyDirty(): boolean {
    return useSignal(useProject().textModels.anyDirty)
}

const EMPTY_STRING_SIGNAL = { peek: () => '', value: '', subscribe: () => () => {} }

function useSignalOrEmpty(
    s: { peek: () => string; value: string; subscribe: (cb: () => void) => () => void } | undefined,
): string {
    return useSignal((s ?? EMPTY_STRING_SIGNAL) as Parameters<typeof useSignal<string>>[0])
}
