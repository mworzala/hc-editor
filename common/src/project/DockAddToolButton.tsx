import { PlusIcon } from 'lucide-react'

import { Button } from '@hollowcube/design-system'

import { AddToolMenu } from './AddToolMenu'
import { type ToolDefinition } from './registry'

type DockAddToolButtonProps = {
    tools: readonly ToolDefinition[]
    onAddTool: (toolKind: string) => void
}

/** Compact "+" button rendered after the tabs in a tool dock's tab bar. */
export function DockAddToolButton({ tools, onAddTool }: DockAddToolButtonProps) {
    return (
        <AddToolMenu
            tools={tools}
            onSelect={onAddTool}
            trigger={
                <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label='Add a tool'
                    className='text-muted-foreground hover:text-foreground'
                >
                    <PlusIcon />
                </Button>
            }
        />
    )
}
