/// <reference types="vite/client" />

// Vite's `*?raw` declaration uses a glob that doesn't always match filenames
// containing a leading `.d.`, so be explicit for the Luau definition files.
declare module '*.d.luau?raw' {
    const src: string
    export default src
}

declare module '*.luau?raw' {
    const src: string
    export default src
}

// Vite's `*?url` glob doesn't always resolve package-subpath imports, so be
// explicit for the WASM binary shipped by `@johnnymorganz/stylua`.
declare module '*.wasm?url' {
    const src: string
    export default src
}

// Side-effect CSS imports: vite/client declares `*.css`, but it isn't resolved
// for bare side-effect imports here, so declare it explicitly.
declare module '*.css' {}
