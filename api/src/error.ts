import { z } from 'zod'

export const ApiErrorSchema = z.object({
    error: z.string(),
})
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>

export interface ApiErrorContext {
    method?: string
    url?: string
    cause?: unknown
}

export class ApiError extends Error {
    readonly status: number
    readonly method?: string
    readonly url?: string

    constructor(status: number, message: string, context?: ApiErrorContext) {
        super(message, context?.cause === undefined ? undefined : { cause: context.cause })
        this.name = 'ApiError'
        this.status = status
        this.method = context?.method
        this.url = context?.url
    }

    static async fromResponse(response: Response, context?: ApiErrorContext): Promise<ApiError> {
        let message = response.statusText || `HTTP ${response.status}`
        try {
            const text = await response.text()
            if (text) {
                const parsed = ApiErrorSchema.safeParse(JSON.parse(text))
                if (parsed.success) message = parsed.data.error
            }
        } catch {
            // fall through; keep statusText
        }
        return new ApiError(response.status, message, context)
    }

    // Wrap a fetch-thrown network error so callers see what URL was attempted.
    // The browser only tells JS the request failed — "Failed to fetch" in
    // Chromium/Firefox, "Load failed" in Safari/WebKit — without saying *why*.
    // Detect by type: fetch throws TypeError for any network-level failure
    // (host unreachable, DNS, TLS, blocked by CORS, mixed content). The actual
    // reason is in the browser's devtools network tab.
    static network(method: string, url: string, cause: unknown): ApiError {
        const original = cause instanceof Error ? cause.message : String(cause)
        const hint =
            cause instanceof TypeError
                ? ' (server unreachable, blocked by CORS, or mixed content — check the browser network tab for the actual reason)'
                : ''
        return new ApiError(0, `${original}${hint}`, { method, url, cause })
    }
}
