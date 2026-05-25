import { Button } from '@hollowcube/design-system'

import { useProjectMetadata } from '../../model/bootstrap'
import { useProjectActions } from '../actions'
import { type EditorDefinition } from '../registry'
import { API_TEST_EDITOR_KIND } from './api-test'

export const WELCOME_EDITOR_KIND = 'editor:welcome'

function WelcomeTab() {
    const project = useProjectMetadata()
    const { openEditor } = useProjectActions()

    return (
        <div className='flex h-full items-center justify-center p-6'>
            <div className='flex max-w-md flex-col items-center gap-3 text-center'>
                <h1 className='text-2xl font-medium tracking-tight'>
                    Welcome to {project?.name ?? ''}
                </h1>
                <p className='text-muted-foreground text-sm'>
                    Open a file from the file tree to get started.
                </p>
                <div className='flex gap-2'>
                    <Button variant='ghost' size='sm'>
                        Get started
                    </Button>
                    <Button
                        variant='outline'
                        size='sm'
                        onClick={() => openEditor({ kind: API_TEST_EDITOR_KIND })}
                    >
                        Open API test
                    </Button>
                </div>
            </div>
        </div>
    )
}

export const welcomeEditor: EditorDefinition = {
    kind: WELCOME_EDITOR_KIND,
    mimeTypes: [],
    singleton: true,
    titleFor: () => 'Welcome',
    render: () => <WelcomeTab />,
}
