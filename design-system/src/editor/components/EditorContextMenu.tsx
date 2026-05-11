import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
} from '@hollowcube/design-system/components/dropdown-menu'
import * as React from 'react'

export type EditorContextMenuCommands = {
    onCut: () => void
    onCopy: () => void
    onPaste: () => void
    onFindUsages: () => void
    onGoToDefinition: () => void
    onFormat: () => void
    onFoldAll: () => void
    onUnfoldAll: () => void
    onFindInFile: () => void
    /** Display value of the token under the cursor, used for the "Find usages" affordance. */
    token: string | null
}

type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    x: number
    y: number
    commands: EditorContextMenuCommands
}

function EditorContextMenu({ open, onOpenChange, x, y, commands }: Props) {
    // Virtual anchor that resolves to a zero-size DOMRect at the click point.
    const anchor = React.useMemo(
        () => ({
            getBoundingClientRect() {
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
            },
        }),
        [x, y],
    )

    const handle = (fn: () => void) => () => {
        onOpenChange(false)
        fn()
    }

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuContent anchor={anchor} side='bottom' align='start' sideOffset={2}>
                <DropdownMenuItem onClick={handle(commands.onCut)}>
                    Cut
                    <DropdownMenuShortcut>⌘X</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handle(commands.onCopy)}>
                    Copy
                    <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handle(commands.onPaste)}>
                    Paste
                    <DropdownMenuShortcut>⌘V</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={!commands.token}
                    onClick={handle(commands.onFindUsages)}
                >
                    Find usages{commands.token ? ` of "${commands.token}"` : ''}
                    <DropdownMenuShortcut>F7</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handle(commands.onGoToDefinition)}>
                    Go to definition
                    <DropdownMenuShortcut>F12</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handle(commands.onFormat)}>
                    Format document
                    <DropdownMenuShortcut>⌥⇧F</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handle(commands.onFoldAll)}>Fold all</DropdownMenuItem>
                <DropdownMenuItem onClick={handle(commands.onUnfoldAll)}>
                    Unfold all
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handle(commands.onFindInFile)}>
                    Find in file
                    <DropdownMenuShortcut>⌘F</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export { EditorContextMenu }
