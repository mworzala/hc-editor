export const HOLLOWCUBE_COMMON_VERSION = '0.0.0' as const

export type Brand<T, B extends string> = T & { readonly __brand: B }
