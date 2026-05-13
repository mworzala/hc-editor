import { useEffect, useRef } from 'react'

// Listens for two presses of `key` within `windowMs` and calls `fn`. Bespoke
// because @tanstack/react-hotkeys doesn't model double-tap modifier gestures —
// and we don't want to bloat the Action shape with a one-off keybinding form.
//
// Quirks:
//
//   • Ignores `event.repeat` (held key counts as one press).
//   • Cancels the gesture if any other key fires between the two taps, so
//     "shift+a, then shift+shift" still works.
//   • Cancels if any non-target modifier is held with the tap (Ctrl/Alt/Meta
//     plus Shift would be a different intent).
//   • Suppresses while the user is typing in an editable element so we don't
//     hijack Shift while they're capitalizing letters.

type Options = {
    windowMs?: number
    enabled?: boolean
}

export function useDoubleTapKey(key: string, fn: () => void, opts: Options = {}) {
    const { windowMs = 350, enabled = true } = opts
    const fnRef = useRef(fn)
    fnRef.current = fn

    useEffect(() => {
        if (!enabled) return
        let lastAt = 0
        let armed = false

        function onKeyDown(e: KeyboardEvent) {
            if (e.repeat) return
            if (isEditableTarget(e.target)) {
                armed = false
                return
            }
            // Any non-target key resets the gesture so an unrelated keypress
            // doesn't quietly arm the trigger.
            if (e.key !== key) {
                armed = false
                return
            }
            // For Shift: when the key IS the modifier we're tracking, allow
            // shiftKey to be true (it always will be on the second tap) but
            // disallow other modifiers.
            if (e.ctrlKey || e.altKey || e.metaKey) {
                armed = false
                return
            }
            const now = performance.now()
            if (armed && now - lastAt <= windowMs) {
                armed = false
                fnRef.current()
                return
            }
            armed = true
            lastAt = now
        }

        window.addEventListener('keydown', onKeyDown, true)
        return () => window.removeEventListener('keydown', onKeyDown, true)
    }, [key, windowMs, enabled])
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true
    if (target.isContentEditable) return true
    // CodeMirror's contenteditable surface is on a child; closest catches it.
    if (target.closest('[contenteditable="true"]')) return true
    return false
}
