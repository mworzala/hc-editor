// React hooks for the WorkspaceLayoutService. The only model-file under
// `common/src/model/workspace/` that imports React — the oxlint override
// exempts files named `react.ts` / `react.tsx`.
//
// Two reading patterns:
//
//   • `useLayout()` returns the service instance. Use for dispatch.
//   • `useLayoutState()` returns a full `WorkspaceState` snapshot via
//     `useSignal(layout.state)`. Convenient for migrating consumers that
//     previously called `useStore()` and read many slices.
//
// For fine-grained reactivity prefer `useSignal(layout.columnSizes)` and
// friends. The composite snapshot rerenders every time anything changes;
// the slice signals only fire when their specific slice changes.

import { useProject } from '../foundation/react'
import { useSignal } from '../foundation/react'

import type { WorkspaceLayoutService } from './WorkspaceLayoutService'

export function useLayout(): WorkspaceLayoutService {
    return useProject().layout
}

export function useLayoutState() {
    return useSignal(useLayout().state)
}

export function useColumnSizes() {
    return useSignal(useLayout().columnSizes)
}

export function useMiddleSizes() {
    return useSignal(useLayout().middleSizes)
}

export function useDocksVisible() {
    return useSignal(useLayout().docksVisible)
}

export function useCenter() {
    return useSignal(useLayout().center)
}

export function useFocusedLeafId() {
    return useSignal(useLayout().focusedLeafId)
}

export function useActiveDrag() {
    return useSignal(useLayout().activeDrag)
}

export function useHoveredPaneId() {
    return useSignal(useLayout().hoveredPaneId)
}
