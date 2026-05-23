// Single re-export point for the signals primitives every service uses.
//
// Routing all internal usage through this file means a future swap (or a
// shim layer) is a one-file change. Direct imports from
// `@preact/signals-core` outside this module are discouraged; services
// should import from here.

export {
    batch,
    computed,
    effect,
    signal,
    untracked,
    type ReadonlySignal,
    type Signal,
} from '@preact/signals-core'
