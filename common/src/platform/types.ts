import type { MenuPath } from '../project/actions/types'

export type Storage = {
    get(key: string): string | null
    set(key: string, value: string): void
    remove(key: string): void
}

export type PlatformKind = 'web' | 'desktop'

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

/** Where the launch code comes from. Web reads (and strips) `location.hash`.
 *  Desktop has no source today — the web→native handoff (Wails deep link)
 *  isn't built yet. Absence means "no pending launch code". */
export type LaunchCodeSource = {
    /** Read and consume the pending launch code, if any. Single-use:
     *  implementations strip it from their source so a reload can't replay. */
    take(): Promise<string | null>
}

export type Platform = {
    kind: PlatformKind
    storage: Storage
    /** Absolute base URL for the API host (no trailing slash, no `/v1`).
     *  Always set in practice and always absolute — there is no same-origin
     *  mode. Web is cross-origin (editor on `hollowcube.net`, API on
     *  `api.hollowcube.net`); the value is env-driven and validated at
     *  startup (`web/src/env.ts`). Desktop sets it to reach the Go server
     *  directly, bypassing the Wails `wails://` custom-scheme handler which
     *  drops HTTP bodies (WebKit bug 192315). `canonicalHtu` derives the DPoP
     *  `htu` from the absolute request URL, so the base origin must match
     *  what the backend reconstructs behind Envoy. Optional only so
     *  test/SSR Platform impls can omit it. */
    apiBaseUrl?: string
    /** Set the window/tab title. Web → `document.title`; desktop → Wails
     *  `Window.SetTitle`. Required because both platforms can do it cheaply
     *  and consumers shouldn't have to branch on `kind`. */
    setWindowTitle(title: string): void
    /** Native menu bridge — desktop only. */
    menu?: MenuController
    /** Pending launch-code source. Web injects a `location.hash` reader;
     *  desktop has none until the Wails deep-link handoff lands. */
    launchCode?: LaunchCodeSource
    /** Dev-only: when true, skip the real launch/redeem/token flow and treat
     *  every request as authenticated. The auth hook returns a stub token and
     *  proof, so the backend must be running with a matching auth-disabled
     *  flag for requests to succeed. The shell only sets this when
     *  `import.meta.env.DEV` is true, so production builds tree-shake it out. */
    devDummyAuth?: boolean
    /** Dev-only: when set, force this string as the active project (map) id,
     *  bypassing whatever the launch grant carried (or the absence of one).
     *  Lets local dev / Claude Preview open a workspace without a real
     *  in-game launch. Production builds never read this. */
    devMapIdOverride?: string
    /** Dev-only: when set, send this value as the `x-auth-user` header on
     *  every API request. Pairs with the backend's auth-disabled mode,
     *  which reads the user identity from this header instead of the
     *  access token. Production builds never read this. */
    devAuthUser?: string
}
