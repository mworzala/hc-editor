import type { LaunchCodeSource } from '../../platform'

// FLAG(backend): web launch-code transport. The game directs the browser to a
// URL whose fragment carries the launch grant after a fixed `§k=` marker, e.g.
//
//     http://localhost:5173/#§k=I7jcvoA_N7Ak
//
// The `§k=` marker is always present and is purely a delimiter — it is
// ignored; the grant is everything after the `=`. `§` (U+00A7) is often
// percent-encoded by the browser in `location.hash` (`%C2%A7`), so we
// best-effort `decodeURIComponent` before scanning.
//
// IMPORTANT — capture timing: the fragment is read AND stripped *synchronously
// when this source is constructed*, NOT lazily on the first `take()`. The web
// entrypoint (`web/src/main.tsx`) constructs it at module top-level, before
// `createRoot().render()`, so this runs before React Router mounts. React
// Router's browser history takes over the URL during mount and the fragment is
// gone by the time `AuthProvider.init()` (which awaits the keystore before
// calling `take()`) gets to it — reading it at construction is the only point
// guaranteed to still see it. Stripping it immediately also makes the grant
// single-use: a reload or StrictMode remount cannot replay it.
//
// Desktop uses hash routing and has no source today; the Wails deep-link
// handoff that will eventually provide the code is unbuilt.
const MARKER = '§k='

function captureLaunchCode(): string | null {
    const loc = globalThis.location
    const rawHash = loc?.hash ?? ''

    if (rawHash.length <= 1) {
        return null
    }

    const body = rawHash.slice(1)
    let decoded = body
    try {
        decoded = decodeURIComponent(body)
    } catch (err) {
        console.warn('[launch] decodeURIComponent failed, scanning raw fragment', err)
    }

    // Strip the entire hash now — unconditionally, so a used/bad grant can
    // never be replayed by a reload, and so it does not linger in the URL.
    const stripped = (loc?.pathname ?? '') + (loc?.search ?? '')
    globalThis.history?.replaceState(null, '', stripped)

    const idx = decoded.indexOf(MARKER)
    if (idx === -1) {
        console.warn(
            `[launch] marker ${JSON.stringify(MARKER)} not found in fragment — no launch code`,
        )
        return null
    }

    const code = decoded.slice(idx + MARKER.length).trim()
    if (!code) {
        console.warn('[launch] marker found but launch code is empty')
        return null
    }

    return code
}

export function createHashLaunchCodeSource(): LaunchCodeSource {
    // Capture synchronously, here, at construction — see the note above.
    let pending = captureLaunchCode()
    return {
        take: () => {
            // Single-use: hand the captured code over exactly once.
            const code = pending
            pending = null
            return Promise.resolve(code)
        },
    }
}
