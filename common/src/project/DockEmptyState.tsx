import { PlusIcon } from 'lucide-react'

import { Button } from '@hollowcube/design-system'

import { AddToolMenu } from './AddToolMenu'
import { type ToolDefinition } from './registry'

type DockEmptyStateProps = {
    tools: readonly ToolDefinition[]
    onAddTool: (toolKind: string) => void
}

export function DockEmptyState({ tools, onAddTool }: DockEmptyStateProps) {
    return (
        <div className='text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-xs'>
            <div>Drag a tool here</div>
            <AddToolMenu
                tools={tools}
                onSelect={onAddTool}
                trigger={
                    <Button variant='outline' size='sm'>
                        <PlusIcon />
                        Add a tool
                    </Button>
                }
            />
        </div>
    )
}
