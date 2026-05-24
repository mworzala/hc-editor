import { type EditorDefinition } from '../registry'

export const API_TEST_EDITOR_KIND = 'editor:api-test'

// The original API test demo lived on top of React Query hooks; the
// model layer's services took over fetching and the demo went with it.
// The editor kind stays so the Welcome page's "Open API test" button
// keeps working — it now opens a small explainer pane.

export const apiTestEditor: EditorDefinition = {
    kind: API_TEST_EDITOR_KIND,
    mimeTypes: [],
    singleton: true,
    titleFor: () => 'API test',
    render: () => (
        <div className='text-muted-foreground flex h-full items-center justify-center p-6 text-sm'>
            <div className='max-w-md text-center'>
                The API test demo was removed when the model layer took ownership of
                project fetching. Reach the API via `v1Map*` functions and
                `useApp().client` directly.
            </div>
        </div>
    ),
}
