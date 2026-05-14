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

/** Native menu controller. The host registers a slot-id → action-id table
 *  once on mount, then subscribes to `onInvoke` to receive clicks on native
 *  menu items. The Go side owns the menu structure; the JS side just routes
 *  clicks through the action registry. Desktop only.
 *
 *  The bridge has no opinion about what an action is — it just forwards slot
 *  strings. The slot table lives in the frontend, alongside the action
 *  registrations, so adding a menu item is a Go change + a one-line JS table
 *  update. */
export type MenuController = {
    /** Optional: register a slot map so the controller can validate or
     *  pre-warm. Most impls treat this as a no-op since the lookup happens
     *  in the action registry layer above. */
    register?: (slotMap: Readonly<Record<string, string>>) => void
    /** Subscribe to native menu clicks. Returns an unsubscribe function. */
    onInvoke: (handler: (slotId: string) => void) => () => void
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
