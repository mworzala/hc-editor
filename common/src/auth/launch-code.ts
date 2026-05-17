import type { LaunchCodeSource } from '../platform'

// FLAG(backend): provisional web launch-code transport. The code arrives as a
// URL fragment `#code=<launch_code>`. We read AND strip it synchronously on
// the first take() (no await before the strip) so a reload or React
// StrictMode remount cannot replay a single-use code. Web uses browser-history
// routing, so the fragment does not collide with the router. Desktop uses hash
// routing and gets NO hash source in Phase 1 (handoff is Phase 2 — a Wails
// deep-link event will provide the code instead).
export function createHashLaunchCodeSource(): LaunchCodeSource {
    return {
        // Not async: the read + strip run synchronously (no await before
        // replaceState) so a StrictMode remount or reload can't replay the
        // single-use code; the result is wrapped to satisfy the interface.
        take: () => {
            const loc = globalThis.location
            const hash = loc?.hash ?? ''
            if (hash.length <= 1) return Promise.resolve(null)
            const params = new URLSearchParams(hash.slice(1))
            const code = params.get('code')
            if (!code) return Promise.resolve(null)
            params.delete('code')
            const rest = params.toString()
            globalThis.history.replaceState(
                null,
                '',
                loc.pathname + loc.search + (rest ? `#${rest}` : ''),
            )
            return Promise.resolve(code)
        },
    }
}
