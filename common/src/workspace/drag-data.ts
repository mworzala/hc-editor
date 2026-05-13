import { type DockId, type DragSide } from './types'

// All drag/drop payloads exchanged with dnd-kit go through this discriminated
// union. Replaces the four ad-hoc `as { kind?: ... }` casts that used to live
// at each drag handler — typos now fail at the source.

export type DragData =
    | { kind: 'tab'; paneId: string; tabId: string }
    | { kind: 'tool-dock'; dockId: DockId }
    | { kind: 'editor-leaf'; leafId: string }
    | { kind: 'split-edge'; leafId: string; side: DragSide }

export function makeDragData(d: DragData): Record<string, unknown> {
    return d as unknown as Record<string, unknown>
}

export function readDragData(source: { data: { current?: unknown } } | null): DragData | null {
    const c = source?.data.current
    if (!c || typeof c !== 'object') return null
    const kind = (c as { kind?: unknown }).kind
    if (kind === 'tab' || kind === 'tool-dock' || kind === 'editor-leaf' || kind === 'split-edge') {
        return c as DragData
    }
    return null
}
