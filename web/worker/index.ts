// Routing Worker for the `/editor` subpath deployment.
//
// A Cloudflare route (e.g. `hollowcube.net/editor/*`) only decides *which*
// requests reach this Worker — it does NOT strip the matched prefix, and the
// static-assets layer maps the full path to a file at the assets root. The
// client is built with Vite `base: '/editor/'`, so its files live at the
// assets root (`/index.html`, `/assets/*`) while the browser requests them
// under `/editor/...`. This Worker bridges the two: strip `/editor`, then let
// the ASSETS binding serve the file (with SPA fallback to index.html for
// client-side routes). Anything outside `/editor` 404s — `/` does not resolve.

interface Env {
    ASSETS: { fetch(request: Request): Promise<Response> }
}

const PREFIX = '/editor'

export default {
    fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)
        if (url.pathname === PREFIX || url.pathname.startsWith(`${PREFIX}/`)) {
            url.pathname = url.pathname.slice(PREFIX.length) || '/'
            return env.ASSETS.fetch(new Request(url, request))
        }
        return Promise.resolve(new Response('Not found', { status: 404 }))
    },
}
