import type { MenuPath } from '../project/actions/types'

export type Storage = {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
}

export type PlatformKind = 'web' | 'desktop'

/** Local file-system bridge. Implemented on desktop (Wails); absent on web.
 *  Consumers should treat absence as "feature not available" and degrade. */
export type FileSystem = {
    readText(path: string): Promise<string>
    writeText(path: string, contents: string): Promise<void>
    exists(path: string): Promise<boolean>
    /** Watch a path for changes. Returns an unsubscribe function. */
    watch(path: string, onChange: (kind: 'create' | 'modify' | 'delete') => void): () => void
}

/** Native dialogs (open, save, confirm). On web we fall back to the browser's
 *  HTML5 file pickers or `window.confirm`. */
export type Dialogs = {
    pickFile(opts?: {
        filters?: ReadonlyArray<{ name: string; extensions: string[] }>
    }): Promise<string | null>
    pickSave(opts?: {
        defaultPath?: string
        filters?: ReadonlyArray<{ name: string; extensions: string[] }>
    }): Promise<string | null>
    confirm(message: string, opts?: { title?: string; danger?: boolean }): Promise<boolean>
}

/** Native window controls (title, minimize, fullscreen). Desktop only. */
export type WindowControls = {
    setTitle(title: string): void
    minimize(): void
    toggleFullScreen(): void
    close(): void
}

/** Wire-format payload for a single native menu item. Built from registered
 *  actions on the frontend and pushed wholesale to the Go-side menu builder. */
export type MenuItemPayload = {
    path: MenuPath
    actionId: string
    label: string
    group: string
    order: number
    /** Wails accelerator string (e.g. `'CmdOrCtrl+N'`). Empty when no shortcut. */
    accelerator: string
    enabled: boolean
}

/** Native menu controller. The frontend owns the dynamic menu structure —
 *  it computes a list of items from the action registry (+ current context)
 *  and pushes it to the host via `setItems`. Click events flow back through
 *  `onInvoke` carrying the originating action id. Desktop only. */
export type MenuController = {
    /** Replace the dynamic menu items with the given payload. Idempotent —
     *  the host rebuilds atomically each call. */
    setItems(items: readonly MenuItemPayload[]): void
    /** Subscribe to native menu clicks. The handler receives the clicked
     *  item's action id. Returns an unsubscribe function. */
    onInvoke: (handler: (actionId: string) => void) => () => void
}

export type Platform = {
    kind: PlatformKind
    storage: Storage
    /** Absolute base URL for the API host (no trailing slash, no `/v1`). Used
     *  on desktop to bypass the Wails `wails://` custom-scheme handler, which
     *  drops HTTP bodies (WebKit bug 192315) — XHR/fetch must hit the Go
     *  server directly. Web leaves this undefined and uses same-origin URLs
     *  through the Vite proxy. */
    apiBaseUrl?: string
    /** Filesystem access — desktop only. */
    fs?: FileSystem
    /** Native dialogs — desktop only. */
    dialogs?: Dialogs
    /** Native window controls — desktop only. */
    window?: WindowControls
    /** Native menu bridge — desktop only. */
    menu?: MenuController
}
