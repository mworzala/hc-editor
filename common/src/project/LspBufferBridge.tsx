import { useEffect } from 'react'

import { fileUriFromPath } from '../lsp'
import { useLuauLsp, useProject } from '../model'
import { effect } from '../model/foundation/signal'

// Translates TextModel lifecycle into LSP traffic for Luau buffers.
// Mounted once at project level inside `<ModelProjectProvider>` +
// `<LuauLspProvider>`.
//
// Lifetime model: once the bridge has sent `textDocument/didOpen` for a
// URI, the LSP keeps tracking that file for the rest of the session. We
// deliberately do NOT mirror the TextModelService's refcount-based
// eviction. `LspClient.openDocument` is idempotent.

function isLuauDocId(id: string): boolean {
    if (id.startsWith('unsaved:')) return false
    return id.endsWith('.luau') || id.endsWith('.lua')
}

export function LspBufferBridge() {
    const { textModels } = useProject()
    const { client, status } = useLuauLsp()

    useEffect(() => {
        if (!client || status !== 'running') return

        const seenContent = new Map<string, string>() // docId -> last content sent

        const stop = effect(() => {
            // Track every open model + its content. Service's `openModels`
            // computed re-fires when the registration set changes; reading
            // `content.value` per model auto-subscribes to per-model
            // content changes too. Reads use `.value` so this effect
            // re-runs on any relevant change — exactly the equivalent of
            // the old document-store `subscribe`.
            for (const model of textModels.openModels.value) {
                if (!isLuauDocId(model.id)) continue
                const content = model.content.value
                const uri = fileUriFromPath(model.id)
                if (!seenContent.has(model.id)) {
                    seenContent.set(model.id, content)
                    client.openDocument(uri, 'luau', content)
                    continue
                }
                const prev = seenContent.get(model.id)
                if (prev !== content) {
                    seenContent.set(model.id, content)
                    client.didChange(uri, content)
                }
            }
        })

        return () => {
            stop()
            seenContent.clear()
        }
    }, [client, status, textModels])

    return null
}
