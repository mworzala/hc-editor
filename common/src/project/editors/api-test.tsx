import { ApiTestDemo } from '../../demo/ApiTestDemo'
import { type EditorDefinition } from '../registry'

export const API_TEST_EDITOR_KIND = 'editor:api-test'

export const apiTestEditor: EditorDefinition = {
    kind: API_TEST_EDITOR_KIND,
    mimeTypes: [],
    titleFor: () => 'API test',
    render: () => <ApiTestDemo />,
}
