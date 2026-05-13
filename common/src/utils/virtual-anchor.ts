import { useMemo } from 'react'

// A "virtual element" anchor for floating menus / popovers — base-ui calls
// `getBoundingClientRect()` synchronously each frame, so by returning a
// zero-size rect at a click point the menu lines up from the first paint
// (a real DOM element initialized at (0,0) then moved in useEffect would
// briefly render top-left).

export type VirtualAnchor = {
    getBoundingClientRect: () => DOMRect
}

export function pointRect(x: number, y: number): DOMRect {
    return {
        x,
        y,
        left: x,
        top: y,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
        toJSON() {
            return { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 }
        },
    } as DOMRect
}

/** Stable virtual-anchor for the given (x, y). Memoized so consumers can pass
 *  it through props without forcing a re-positioning on every render. */
export function usePointAnchor(x: number, y: number): VirtualAnchor {
    return useMemo(() => ({ getBoundingClientRect: () => pointRect(x, y) }), [x, y])
}
