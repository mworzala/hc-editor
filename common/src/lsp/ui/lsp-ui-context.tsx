import { useSyncExternalStore } from 'react'

import { useProject } from '../../model/foundation/react'
import { type LspUiBus } from './lsp-ui-bus'

// LspUiBus now lives on `Project.lsp.ui`. These hooks read through to it so
// existing call sites (just `<LspUiOverlay />`) keep working.

export function useLspUiBus(): LspUiBus {
    return useProject().lsp.ui
}

export function useLspUiSnapshot() {
    const bus = useLspUiBus()
    return useSyncExternalStore(
        (cb) => bus.subscribe(cb),
        () => bus.getSnapshot(),
        () => bus.getSnapshot(),
    )
}
