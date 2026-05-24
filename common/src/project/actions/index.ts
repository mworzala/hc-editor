// Action surface for the project shell.
//
// Actions themselves (the type, the registry) live in the model layer at
// `common/src/model/actions/*`. This module exports the React-side
// bridges + helpers that ride on top: the hotkey bridge, the native-menu
// bridge, and the ad-hoc `ActionContextMenu` component for right-click
// menus.

export { ActionHotkeyBridge } from './hotkey-bridge'
export { NativeMenuBridge } from './NativeMenuBridge'
export {
    ActionContextMenu,
    type ActionContextMenuProps,
    type ContextMenuAction,
} from './ActionContextMenu'

// Host-level project actions (open editor, open tool). Different concept
// from the registry: these are layout-orchestration helpers, not
// registered commands.
export {
    useProjectActions,
    useProjectActionsForLayout,
    type OpenEditorArgs,
    type OpenEditorTarget,
    type ProjectActions,
} from './project-actions'
