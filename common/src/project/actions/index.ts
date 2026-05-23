// Action registry — `Action`, registration hooks, hotkey bridge.
export {
    type Action,
    type ActionContextSet,
    type ActionRunContext,
    type ActionRunSource,
} from './types'
export { ActionRegistryProvider, useActions, useRegisterAction, useRunAction } from './registry'
export { ActionHotkeyBridge } from './hotkey-bridge'
export {
    ActionContextProvider,
    actionMatchesContext,
    useActionContextSet,
    useActionContextSnapshot,
} from './context'
export { ActionContextMenu, type ActionContextMenuProps } from './ActionContextMenu'
export { EditorActions } from './EditorActions'
export { NativeMenuBridge } from './NativeMenuBridge'

// Host-level project actions (open editor, open tool). Different concept from
// the registry above, but lives in this folder because it's the same conceptual
// space: "things the host can do for you."
export {
    useProjectActions,
    useProjectActionsForLayout,
    type OpenEditorArgs,
    type OpenEditorTarget,
    type ProjectActions,
} from './project-actions'
