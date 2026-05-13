import { type ReactElement } from 'react'

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@hollowcube/design-system'

import { type ToolDefinition } from './registry'

type AddToolMenuProps = {
    tools: readonly ToolDefinition[]
    onSelect: (toolKind: string) => void
    /** The element rendered as the dropdown trigger (button, icon button, etc.). */
    trigger: ReactElement
}

/** Dropdown that lists every registered tool. Used by both the empty-dock state
 *  and the trailing "+" button at the end of a tool dock's tab bar. */
export function AddToolMenu({ tools, onSelect, trigger }: AddToolMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={trigger} />
            <DropdownMenuContent align='center' side='bottom'>
                {tools.map((tool) => (
                    <DropdownMenuItem key={tool.kind} onClick={() => onSelect(tool.kind)}>
                        {tool.icon}
                        <span>{tool.title}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
