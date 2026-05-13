import type { HCTransport, HCTransportInit } from '@hollowcube/api'

import { ProjectService } from '../bindings/changeme'

// HCTransport implementation that routes PUT/DELETE/PATCH through the Go
// ProjectService. The Wails JS bridge serializes args/return as JSON, so
// bodies have to be strings (Go []byte over JSON gets base64-encoded, which
// the alpha binding generator doesn't surface cleanly yet; we use strings
// instead). For text uploads this is fine. Binary uploads will need a base64
// variant on both sides.
export const desktopApiTransport: HCTransport = async (method, url, init) => {
    const path = pathFromUrl(url)
    const contentType = readContentType(init.headers)
    const body = await bodyToString(init.body)

    const result = await ProjectService.Request(method, path, contentType, body)

    return new Response(result.body || null, {
        status: result.status,
        statusText: result.statusText,
        headers: result.contentType ? { 'Content-Type': result.contentType } : undefined,
    })
}

// Accept absolute URLs (http://host/v1/...) and root-relative paths (/v1/...)
// alike — the Go service prepends the upstream base URL itself.
function pathFromUrl(url: string): string {
    if (url.startsWith('/')) return url
    try {
        const parsed = new URL(url)
        return parsed.pathname + parsed.search
    } catch {
        return url
    }
}

function readContentType(headers: HeadersInit | undefined): string {
    if (!headers) return ''
    const h = new Headers(headers)
    return h.get('content-type') ?? ''
}

async function bodyToString(body: HCTransportInit['body']): Promise<string> {
    if (body === undefined || body === null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Blob) return body.text()
    if (body instanceof ArrayBuffer) return new TextDecoder().decode(body)
    if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body)
    if (body instanceof FormData || body instanceof URLSearchParams) {
        // Shouldn't happen for our endpoints, but degrade rather than throw.
        return new URLSearchParams(body as URLSearchParams).toString()
    }
    return String(body)
}
