import { useProject } from '../foundation/react'
import { useSignal } from '../foundation/react'
import type { DialogService, DialogState } from './DialogService'

export function useDialogs(): DialogService {
    return useProject().dialogs
}

export function useActiveDialog(): DialogState | null {
    return useSignal(useDialogs().active)
}
