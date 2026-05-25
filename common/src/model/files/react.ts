import { useSignal } from '../foundation/react'
import { useProject } from '../foundation/react'
import type { PendingFile } from './PendingFilesService'

export function usePendingFiles(): readonly PendingFile[] {
    return useSignal(useProject().pendingFiles.list)
}

export function usePendingFile(tempId: string | undefined): PendingFile | undefined {
    const entries = useSignal(useProject().pendingFiles.entries)
    if (!tempId) return undefined
    return entries.get(tempId)
}

export function usePendingFilesService() {
    return useProject().pendingFiles
}

/** Sorted array of `MapFile`s. Convenient for `buildFileTree(list, …)`. */
export function useFileTree() {
    return useSignal(useProject().fileTree.list)
}

/** Path → MapFile map. */
export function useFiles() {
    return useSignal(useProject().fileTree.files)
}

export function useFileTreeService() {
    return useProject().fileTree
}

export function useFileOperations() {
    return useProject().fileOperations
}
