import { useEffect } from 'react'

import { useProject } from '../model'
import { useLayoutState } from '../model/workspace'
import { findLeaf } from '../workspace'

// Pushes the currently focused leaf's active tab id into
// `ActiveEditorRegistry.activeDocId`. This is the one React → model push
// the architecture doc calls out for editor focus: layout reactivity lives
// in the model, but "which tab is currently focused in the UI" is derived
// from React-side workspace state and needs an explicit hop.

export function EditorFocusBridge() {
    const project = useProject()
    const layout = useLayoutState()

    useEffect(() => {
        const focusedId = layout.focusedLeafId
        let next: string | null = null
        if (focusedId) {
            const leaf = findLeaf(layout.center, focusedId)
            next = leaf?.activeId ?? null
        }
        project.activeEditor.setActiveDocId(next)
    }, [project, layout])

    return null
}
