import { useEffect, useId, useRef, useState } from 'react'

import {
    Button,
    Dialog,
    DialogOverlay as BaseDialogOverlay,
    DialogPopup,
    DialogPortal,
    Input,
    Label,
    cn,
} from '@hollowcube/design-system'

import { useActiveDialog } from '../model/dialogs/react'
import type { SavePathDialogState } from '../model/dialogs/DialogService'

// Renders the active `DialogService` state as a modal dialog. One per
// project; mounted alongside the rest of the project chrome.

export function DialogOverlay() {
    const active = useActiveDialog()
    if (!active) return null
    if (active.kind === 'savePath') {
        return <SavePathDialog state={active} key='savePath' />
    }
    return null
}

function SavePathDialog({ state }: { state: SavePathDialogState }) {
    const [value, setValue] = useState(state.suggested)
    const inputId = useId()
    const inputRef = useRef<HTMLInputElement | null>(null)
    useEffect(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [])
    const trimmed = value.trim()
    return (
        <Dialog
            open
            onOpenChange={(next) => {
                if (!next) state.cancel()
            }}
        >
            <DialogPortal>
                <BaseDialogOverlay />
                <DialogPopup
                    aria-label='Save as'
                    className={cn(
                        'fixed top-1/3 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
                        'w-[420px] max-w-[calc(100vw-2rem)]',
                        'flex flex-col gap-3 p-4',
                        'rounded-xl bg-popover text-popover-foreground ring-1 ring-border shadow-xl outline-none',
                        'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
                        'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
                    )}
                >
                    <Label htmlFor={inputId}>Save as</Label>
                    <Input
                        id={inputId}
                        ref={inputRef}
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && trimmed) {
                                e.preventDefault()
                                state.confirm(trimmed)
                            } else if (e.key === 'Escape') {
                                e.preventDefault()
                                state.cancel()
                            }
                        }}
                        placeholder='path/to/file.txt'
                    />
                    <div className='flex justify-end gap-2'>
                        <Button size='sm' variant='ghost' onClick={() => state.cancel()}>
                            Cancel
                        </Button>
                        <Button size='sm' disabled={!trimmed} onClick={() => state.confirm(trimmed)}>
                            Save
                        </Button>
                    </div>
                </DialogPopup>
            </DialogPortal>
        </Dialog>
    )
}
