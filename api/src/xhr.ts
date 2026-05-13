// Fallback transport for PUT/DELETE/PATCH on WKWebView.
//
// WKWebView (Wails on macOS) silently drops the body of a fetch() request when
// the method is anything other than GET or POST — see WebKit bug 219732. The
// server sees Content-Length: 0 and the empty-string sha256 hash. XHR uses a
// different code path inside WKWebView and is unaffected.
//
// This helper returns a standard Response so the calling code in HCClient.send
// can treat XHR and fetch results identically (ok flag, .json(), .arrayBuffer(),
// headers, etc.).

export interface XhrRequestInit {
    headers?: HeadersInit
    body?: BodyInit | null
    signal?: AbortSignal
}

export function xhrRequest(method: string, url: string, init?: XhrRequestInit): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
            reject(abortError())
            return
        }

        const xhr = new XMLHttpRequest()
        xhr.open(method, url, true)
        xhr.responseType = 'arraybuffer'

        if (init?.headers) {
            const headers = new Headers(init.headers)
            headers.forEach((value, key) => {
                xhr.setRequestHeader(key, value)
            })
        }

        const onAbort = () => {
            try {
                xhr.abort()
            } catch {
                // already settled
            }
        }
        const cleanup = () => {
            if (signal) signal.removeEventListener('abort', onAbort)
        }
        if (signal) signal.addEventListener('abort', onAbort)

        xhr.addEventListener('load', () => {
            cleanup()
            // status 0 on load (rare) is treated the same as a network error
            // to keep fetch semantics — caller's catch is for transport
            // failures, not HTTP errors.
            if (xhr.status === 0) {
                reject(new TypeError('Network request failed'))
                return
            }
            const headers = parseHeaders(xhr.getAllResponseHeaders())
            const body = bodyAllowedForStatus(xhr.status)
                ? (xhr.response as ArrayBuffer | null)
                : null
            try {
                resolve(
                    new Response(body, {
                        status: xhr.status,
                        statusText: xhr.statusText,
                        headers,
                    }),
                )
            } catch (e) {
                reject(e)
            }
        })
        xhr.addEventListener('error', () => {
            cleanup()
            reject(new TypeError('Network request failed'))
        })
        xhr.addEventListener('timeout', () => {
            cleanup()
            reject(new TypeError('Network request timed out'))
        })
        xhr.addEventListener('abort', () => {
            cleanup()
            reject(abortError())
        })

        try {
            xhr.send(toXhrBody(init?.body))
        } catch (e) {
            cleanup()
            reject(e)
        }
    })
}

function toXhrBody(body: BodyInit | null | undefined): XMLHttpRequestBodyInit | null {
    if (body === undefined || body === null) return null
    // Encode strings as raw UTF-8 bytes rather than passing them to xhr.send()
    // as-is. WKWebView's send(string) path has historically had quirks; sending
    // an ArrayBufferView avoids them entirely. The caller-supplied Content-Type
    // header still controls how the server interprets the bytes.
    if (typeof body === 'string') return new TextEncoder().encode(body)
    if (body instanceof Blob) return body
    if (body instanceof ArrayBuffer) return body
    if (ArrayBuffer.isView(body)) return body
    if (body instanceof FormData) return body
    if (body instanceof URLSearchParams) return body
    throw new TypeError(
        'xhrRequest: unsupported body type. Pass a string, Blob, ArrayBuffer, or typed array.',
    )
}

function parseHeaders(raw: string): Headers {
    const headers = new Headers()
    for (const line of raw.split(/\r?\n/u)) {
        if (!line) continue
        const idx = line.indexOf(':')
        if (idx === -1) continue
        const name = line.slice(0, idx).trim()
        const value = line.slice(idx + 1).trim()
        if (name) headers.append(name, value)
    }
    return headers
}

function abortError(): DOMException {
    return new DOMException('The operation was aborted.', 'AbortError')
}

// Response() throws if a body is given alongside a 1xx/204/205/304 status.
function bodyAllowedForStatus(status: number): boolean {
    if (status >= 100 && status < 200) return false
    return status !== 204 && status !== 205 && status !== 304
}
