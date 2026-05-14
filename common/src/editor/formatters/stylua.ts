import wasmUrl from '@johnnymorganz/stylua/stylua_lib_bg.wasm?url'
import init, {
    Config,
    formatCode,
    IndentType,
    LuaVersion,
    OutputVerification,
} from '@johnnymorganz/stylua/web'

import { type FormatResult } from '../languages/types'

// wasm-bindgen `--target web` requires an explicit init call before any
// exported function can run. We do it once, lazily, and cache the promise so
// concurrent formats share a single instantiation. Using the explicit
// `?url`-imported WASM path lets Vite emit the binary as a hashed asset that
// resolves correctly under both the web SPA and Wails' file:// asset host.

let readyPromise: Promise<void> | null = null

function ensureReady(): Promise<void> {
    if (!readyPromise) {
        readyPromise = init({ module_or_path: wasmUrl }).then(() => undefined)
    }
    return readyPromise
}

export async function formatLuau(text: string): Promise<FormatResult> {
    await ensureReady()
    try {
        const config = Config.new()
        config.syntax = LuaVersion.Luau
        config.indent_type = IndentType.Spaces
        config.indent_width = 4
        config.column_width = 120
        const out = formatCode(text, config, null, OutputVerification.None)
        return { ok: true, text: out }
    } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
}
