import type { HCTransport } from '@hollowcube/api'

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

export type Platform = {
    kind: PlatformKind
    storage: Storage
    /** Filesystem access — desktop only. */
    fs?: FileSystem
    /** Native dialogs — desktop only. */
    dialogs?: Dialogs
    /** Native window controls — desktop only. */
    window?: WindowControls
    /** Transport for non-safe API methods (PUT/DELETE/PATCH). Set on desktop
     *  to route through a Go bridge that avoids the WKWebView body-drop bug
     *  and can mirror writes to the local filesystem. Undefined on web — the
     *  client falls back to its built-in XHR shim. */
    apiTransport?: HCTransport
}
