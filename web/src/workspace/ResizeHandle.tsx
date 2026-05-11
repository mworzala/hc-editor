import { cn } from '@hollowcube/design-system/lib/utils'

// Invisible (per spec) but draggable resize handle that occupies a small gap.
// react-resizable-panels wraps this in a `PanelResizeHandle` which provides the
// pointer-event plumbing; this component only renders the visual hit-area.
export function ResizeHandle({ orientation }: { orientation: 'horizontal' | 'vertical' }) {
    return (
        <div
            data-slot='workspace-resize-handle'
            className={cn(
                'shrink-0 bg-transparent',
                orientation === 'horizontal'
                    ? 'h-full w-1 cursor-col-resize'
                    : 'h-1 w-full cursor-row-resize',
            )}
        />
    )
}
