/// <reference types="vite/client" />

// Dev-only overrides. All three are read only when `import.meta.env.DEV` is
// true, so production builds tree-shake the reads out regardless of what's
// set in the environment. See `desktop/frontend/src/main.tsx`.
interface ImportMetaEnv {
    readonly VITE_DEV_API_URL?: string
    readonly VITE_DEV_EDITOR_MAP_ID?: string
    readonly VITE_DEV_DUMMY_AUTH?: string
    readonly VITE_DEV_AUTH_USER?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
