import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

// One-shot range highlight that fades out — used as visual feedback for
// "you just landed here" actions like go-to-definition. Callers dispatch
// `setFlashHighlight` with a `{ from, to }` range; the extension paints a
// background-tinted Decoration for ~800ms and then clears itself.

export const setFlashHighlight = StateEffect.define<
    { from: number; to: number } | null
>()

const flashField = StateField.define<{ from: number; to: number } | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setFlashHighlight)) return e.value
        // Stretch / collapse the range alongside doc edits so the highlight
        // tracks moving content if anything edits in flight.
        if (value && tr.docChanged) {
            const from = tr.changes.mapPos(value.from)
            const to = tr.changes.mapPos(value.to)
            if (to <= from) return null
            return { from, to }
        }
        return value
    },
    provide: (f) =>
        EditorView.decorations.from(f, (range) =>
            range
                ? Decoration.set([
                      Decoration.mark({ class: 'cm-flash-highlight' }).range(
                          range.from,
                          range.to,
                      ),
                  ])
                : Decoration.none,
        ),
})

const FLASH_DURATION_MS = 800

// Auto-clears the flash after a short delay. Lives as a ViewPlugin so it
// has access to `view.dispatch` and gets torn down with the editor.
const flashClearPlugin = ViewPlugin.define((view) => {
    let timer: number | null = null
    return {
        update(update) {
            for (const tr of update.transactions) {
                for (const e of tr.effects) {
                    if (!e.is(setFlashHighlight)) continue
                    if (timer !== null) window.clearTimeout(timer)
                    if (e.value === null) {
                        timer = null
                        continue
                    }
                    timer = window.setTimeout(() => {
                        timer = null
                        view.dispatch({ effects: setFlashHighlight.of(null) })
                    }, FLASH_DURATION_MS)
                }
            }
        },
        destroy() {
            if (timer !== null) window.clearTimeout(timer)
        },
    }
})

// Styling. The animation runs once per painted decoration and starts with
// the primary color band fading down to transparent. Using `currentcolor`
// here would tint the glyphs; we keep `background-color` so the text stays
// at its normal foreground color.
const flashTheme = EditorView.theme({
    '.cm-flash-highlight': {
        backgroundColor: 'transparent',
        borderRadius: '2px',
        animation: 'cm-flash-highlight-fade 800ms ease-out',
    },
    '@keyframes cm-flash-highlight-fade': {
        '0%': {
            backgroundColor: 'color-mix(in srgb, var(--primary) 70%, transparent)',
        },
        '100%': {
            backgroundColor: 'transparent',
        },
    },
})

export function flashHighlight() {
    return [flashField, flashClearPlugin, flashTheme]
}
