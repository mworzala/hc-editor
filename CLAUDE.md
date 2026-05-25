# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web + desktop editor for authoring Luau scripts that run on a Minecraft server's Luau-based server-side scripting engine. Users join the server and then open the web or desktop editor to work on their project. The UI is loosely modelled after JetBrains Fleet "Islands" — a workspace with tool docks on the left/bottom/right and editor panels in the center that split/nest.

## Model architecture (read first)

The model layer is a **services + signals + actions** architecture. Plain TypeScript service classes own state as `@preact/signals-core` signals; user-initiated mutations route through an `ActionRegistry` command bus; reactive context keys (via `ContextService`) gate which actions are enabled at any given moment. Full design doc: [`docs/model-architecture.md`](docs/model-architecture.md). Read it before designing new model code or refactoring existing services. The migration that brought the codebase to this architecture is recorded in [`docs/historical/MIGRATION.md`](docs/historical/MIGRATION.md).

The five principles in short:

1. **Services are plain TypeScript classes.** No React imports anywhere under `common/src/model/**`. Constructor-injected deps. `dispose()` on every service.
2. **State is held in `@preact/signals-core` signals.** Public exposure is `ReadonlySignal<T>`; writes go through service methods. Cross-service derived state is `computed(() => ...)`. Use `.peek()` inside imperative methods (including async ones); use `.value` only inside `computed` / `effect`.
3. **`ActionRegistry` is the universal command bus.** Every user-initiated mutation is an action with an id, optional keybinding, optional when-clause, and a `run` handler. Action handlers live on the service that owns the data — `TextModelService.constructor` registers `editor.save`. UI invokes `actions.run('editor.save')`; it does NOT call service methods directly for user actions. Direct service method calls are fine for non-user-initiated work (component mount/unmount, internal coordination).
4. **`ContextService` holds reactive context keys.** When-clauses like `editorFocused && editorDirty` are evaluated against it. Most keys are derived from other signals via `context.derive(key, fn)`; a few (like `editorFocused`) are pushed in by React via `context.set(key, value)`. The action registry recomputes enabled actions when context signals change.
5. **React is the thin view layer.** Two providers (`<AppProvider>`, `<ProjectProvider>`), one signal adapter hook (`useSignal`), and tiny per-service hooks files (`textModels/react.ts`). Components read via hooks, mutate via `actions.run(...)`, manage view-local state with `useState`. CodeMirror state (cursor, selection, scroll) lives in CodeMirror, not in services.

**Canonical template:** `TextModelService` in [`docs/model-architecture.md`](docs/model-architecture.md). New services follow the same skeleton (typed deps, signals as state, methods as mutations, actions + context keys registered at construction, `Emitter` for discrete events, disposal in reverse order).

**Anti-patterns to avoid** (full list in the doc): importing React from a service, using `.value` in imperative methods, storing model state in React component state, calling service methods directly for user-initiated actions, mutating public signals from outside their service, building UI logic in a service, forgetting `dispose()`.

## Workspace topology

This is a Bun-managed monorepo (`bun.lock`, `workspaces` in root `package.json`) with five packages:

- `@hollowcube/common` — Platform-agnostic app code. **Most of the app lives here.** Exposes several subpath exports (`./platform`, `./workspace`, `./project`, `./editor`, `./model`) — see the layout section below.
- `@hollowcube/design-system` — UI primitives. base-ui (`@base-ui/react`) under the hood, originally scaffolded from shadcn (`components.json` is kept for `shadcn add`). Tailwind v4 via `@tailwindcss/vite`. Icons via `lucide-react`.
- `@hollowcube/api` — Custom HTTP client (`HCClient`) with Zod response validation and plain async endpoint functions under `api/src/endpoints/`. Called directly by model-layer services (e.g. `FileTreeService` calls `v1MapEditorBootstrap`, `TextModelService` calls `v1MapFilesUpdate`).
- `@hollowcube/web` — Browser SPA shell. Vite + React 19, `@generouted/react-router` browser-history routing under `src/pages/`.
- `@hollowcube/desktop` (at `desktop/frontend/`) — Wails 3 frontend shell. Same React/Vite/generouted stack but uses `createHashRouter` and the `@wailsio/runtime` Vite plugin pointed at `./bindings` (generated Go bindings). Sibling `desktop/main.go` is the Wails Go host.

**Platform rule:** `web/` and `desktop/frontend/` should contain only platform-specific glue (entry point, providers, routing root, Wails bridge wiring). All shared screens, stores, and abstractions belong in `common`. Page files under `pages/` should usually be one-line re-exports from `@hollowcube/common/*`.

## `@hollowcube/common` layout

```
common/src/
  model/       Service classes (signals + actions). The model layer.
  platform/    Platform abstraction: { kind: 'web'|'desktop', storage }, PlatformProvider, usePlatform
  workspace/   Workspace primitive — recursive splits, tool docks, dnd-kit
  project/     ProjectWorkspace (the `/` page), top bar, tool/editor registries
  editor/      CodeMirror 6 editor component (CodeEditor) and extensions
  auth/        Auth helpers (DPoP, launch-code redemption, session store)
  lsp/         Luau LSP client + worker + UI overlay
```

`./model` is the source of truth for app state and behavior; everything else is a view layer over it. The workspace primitive (`./workspace`) is a generic layout engine; the project shell (`./project`) is the application-specific consumer that wires tools, editors, and chrome on top of it.

## Workspace UI model

The "workspace" screen is a 3-column / 2-row layout:

- Columns: `left` ToolDock | `center` (editors) | `right` ToolDock — sized by `columnSizes: [l, m, r]`
- The middle column splits vertically: editors on top, `bottom` ToolDock below — sized by `middleSizes: [center, bottom]`
- Center is a recursive tree of `EditorGroup` split nodes (horizontal/vertical) with leaves holding tabs; tool docks are flat tab lists
- Tabs are polymorphic by `kind` (e.g. `'tool:files'`, `'editor:welcome'`) — the host supplies a `tabRegistry: Record<kind, render>`. The primitive doesn't know about tools vs editors; that distinction lives one layer up in `./project`.
- State lives on `Project.layout` (a `WorkspaceLayoutService` in [`common/src/model/workspace/`](common/src/model/workspace/)) — signal-backed slices (`columnSizes`, `middleSizes`, `docksVisible`, `left`/`right`/`bottom`, `center`, `focusedLeafId`), persisted to `localStorage` via the platform's Storage impl with debounced writes. Versioned via `STORAGE_VERSION` (currently 2); bump and write a fresh schema when the shape changes.
- Drag-and-drop uses `@dnd-kit`; tabs can move between docks/leaves and drop on a leaf edge to split it.
- Resizing uses `react-resizable-panels`.

**The primitive has no built-in toolbar.** Hosts compose their own top-bar above it and drive dock visibility through `layout.toggleDock(dock)`. The primitive's `renderEmpty?: (dockId) => ReactNode` prop lets hosts supply a placeholder when a dock has no tabs.

When changing the layout model, update `workspace/types.ts` and `model/workspace/WorkspaceLayoutService.ts` together and bump `STORAGE_VERSION`.

## Project app shell (`common/src/project/`)

`ProjectWorkspace` is the top-level component for the `/` route on web and desktop. It:

- Constructs the model-layer `Project` via `useApp().openProject(projectId, { initialLayout })` once, inside a small `<ProjectModelBridge>` wrapper, and exposes it through `<ProjectProvider>` so descendants reach `useProject().layout` / `.fileTree` / `.textModels` / `.lsp` / etc.
- Mounts a thin bridge tree as siblings of `<Workspace>`: `<LspBufferBridge />`, `<EditorFocusBridge />`, `<ActionHotkeyBridge />`, `<NativeMenuBridge />`. None of these provide React context — they translate model signals into platform side-effects (or vice versa, in EditorFocusBridge's case).
- Renders `<ProjectTopBar />` (window chrome + dock toggles) above `<Workspace />`.

Two registries sit above the workspace primitive's flat `TabRegistry`:

- **`ToolDefinition`** (singleton; lives in a tool dock). Fields: `{ kind, title, icon, defaultLocation: DockId, render }`. Convention: `kind: 'tool:<id>'`. Each tool is a single instance — there's no "two file browsers" case.
- **`EditorDefinition`** (multi-instance; one per open file). Fields: `{ kind, mimeTypes, titleFor?, render }`. Convention: `kind: 'editor:<mime>'` for real editors, `kind: 'editor:<synthetic>'` for non-file editors (e.g. `editor:welcome`). Multiple tabs can hold the same `kind` (same file open in two panes, or two different files of the same type).

`buildTabRegistry(tools, editors)` flattens both into the `Record<TabKind, render>` shape the primitive consumes.

**To add a new tool:** define a `ToolDefinition` under `project/tools/`, then add it to the `TOOLS` array in `ProjectWorkspace.tsx`. The host will be responsible for placing instances (currently they're only added via the initial state; an `openTool` action will come later).

**To add a new editor:** define an `EditorDefinition` under `project/editors/`, then add it to the `EDITORS` array. The opener logic that maps a file's mime type to an editor doesn't exist yet — wire it up when the file-open flow lands.

Empty tool docks render `<DockEmptyState />` ("Drag a tool here"). The bottom and right docks are hidden by default in the initial state; toggling them on reveals this empty state.

## Top bar / window chrome

`ProjectTopBar` is 38px high and matches `desktop/main.go`'s `InvisibleTitleBarHeight: 38`, so on macOS the system traffic lights vertically center within the React-side bar.

Layout from left to right:

- **Traffic-light spacer** — desktop only. 78px transparent `<span>` reserves room for the macOS window buttons. Skip on web.
- **Panel toggle buttons** — `PanelLeftIcon`, `PanelBottomIcon`, `PanelRightIcon` from `lucide-react`. `Button variant={active ? 'secondary' : 'ghost'} size='icon-sm'` with `aria-pressed`. Each wraps in a `Tooltip`.
- **Centered project name** — absolutely positioned at `left-1/2 -translate-x-1/2` so the title centers on the **window**, not on the remaining flex space. Pointer-events disabled so it doesn't interfere with the drag region underneath.
- **Settings button** — `Button size='icon-sm'` with `SettingsIcon`. Currently no `onClick`.

**Window drag region** (desktop): the `<header>` background sets `style={{ WebkitAppRegion: 'drag' }}`. Every interactive child (buttons, the title) sets `WebkitAppRegion: 'no-drag'` so clicks aren't eaten. Web ignores both.

## Platform abstraction

`common/src/platform/` defines the `Platform` type and the `<PlatformProvider>` / `usePlatform()` plumbing. The shape is intentionally small — add a field only when there's a real consumer on both platforms (or when the absence on one platform needs to be expressible).

Required on every platform:

- `kind: 'web' | 'desktop'` — drives desktop-only chrome (traffic-light spacer, drag region).
- `storage: { get, set, remove }` — concrete impls: `createBrowserStorage()` (web + desktop, both use `localStorage`) and `createMemoryStorage()` (testing / SSR).
- `setWindowTitle(title: string): void` — web → `document.title`; desktop → Wails `Window.SetTitle`. Both shells set a placeholder from the project id on mount; the project loader overwrites it with the real map name once the API responds.

Optional:

- `apiBaseUrl: string` — absolute origin for the API host. Always set in practice; optional only so tests/SSR can omit it. Desktop sets it to reach the Go server directly, bypassing the Wails `wails://` custom-scheme handler (which drops HTTP bodies; WebKit bug 192315).
- `menu: MenuController` — desktop-only native menu bridge consumed by `NativeMenuBridge`.
- `launchCode: LaunchCodeSource` — web supplies `createHashLaunchCodeSource()` (reads + strips `location.hash`). Desktop has no source yet — the Wails deep-link handoff is unbuilt.
- Dev-only fields: `devDummyAuth`, `devMapIdOverride`, `devAuthUser`. Set from `import.meta.env.DEV`-gated env vars in the shell's `main.tsx` so production builds tree-shake them.

When adding platform-specific behavior, extend the `Platform` type rather than runtime-detecting Wails or `navigator.userAgent`.

## Active project id

The active project id is sourced **differently per platform — intentionally**:

- **Web** reads it from `sessionStorage` (`hc-active-project`). Per-tab, cleared on tab close, survives reload. `useAuth()` (a thin signal-reading hook over `EditorApp.auth`, the model-layer `AuthService`) surfaces the project from the most recent redeem (`grantedProject`); the web page shell (`web/src/pages/index.tsx`) persists that into sessionStorage and reads it back. A brand-new tab with stored sessions but no fresh grant shows the "open from in-game" screen.
- **Desktop** reads it from the URL (`/#/project/:projectId`). The Go-side `WindowManager` opens each project in its own window with a distinct route. `grantedProject` is ignored on desktop (project list / launcher window is the entry point).

Both flows feed into `ProjectWorkspace({ projectId })`, which uses `hc-project:<projectId>` as the workspace storage key. There is no shared "active project" helper — `getActiveProjectId` / `setActiveProjectId` in `common/src/auth/active-project.ts` are web-only and live there because the launch-grant plumbing they pair with is also web-only.

`AuthGate` only requires an authenticated session; the project-id check is the page shell's job (web falls back to "open from in-game", desktop redirects to the launcher).

## Routes

| Route                 | Component                                              | Notes                                                                                        |
| --------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `/`                   | `ProjectWorkspace` (from `@hollowcube/common/project`) | The real workspace (web: pulls the active project id from `sessionStorage`)                  |
| `/project/:projectId` | `ProjectWorkspace`                                     | Desktop only — each project window opens at this hash route via the launcher's WindowManager |

Page files in `web/src/pages/` and `desktop/frontend/src/pages/` are one-line re-exports — keep them that way.

## Toolchain & commands

Run all commands from the repo root unless noted.

- `bun install` — install deps
- `bun run dev:web` — Vite dev server for the browser app
- `bun run dev:desktop` — `wails3 dev` (Vite on port 9245 + Go host); requires `wails3` CLI and Go installed
- `bun run build:web` / `bun run build:desktop`
- `bun run typecheck` — runs `tsc --noEmit` across every workspace via `bun --filter '*' typecheck`
- `bun run test` — runs `bun test` across every workspace via `bun --filter '*' test`
- `bun run lint` / `bun run lint:fix` — oxlint
- `bun run format` / `bun run format:check` — oxfmt

**Tests use `bun test`.** Scope is the model layer only: service classes, plain-TS registries, pure helpers, persistence migrations. Co-locate `*.test.ts` next to source. Do **not** add tests for React components, CodeMirror integration, the LSP worker end-to-end, or the Wails / native-menu bridge — those stay manually verified. Tests import from `bun:test` (`import { test, expect, describe, beforeEach } from 'bun:test'`). Do not introduce Vitest or Jest.

Workspace-scoped: `bun --filter @hollowcube/web <script>` (e.g. `typecheck`, `dev`, `build`).

Desktop-only Wails tasks live in `desktop/Taskfile.yml` (`task dev`, `task build`, `task build:server`, plus per-OS variants under `darwin:`/`windows:`/`linux:`).

## Conventions

- **Formatter is oxfmt, not Prettier.** Config in `.oxfmtrc.json`: 4-space indent, single quotes (incl. JSX), no semicolons, trailing commas everywhere, 100-col width, LF line endings. Imports are auto-sorted into groups separated by blank lines, in this order: `react*` then other externals, then `@hollowcube/*`, then `~`-prefixed and relative imports, then side-effect/style imports — don't hand-organize imports.
- **Linter is oxlint.** TypeScript, React, react-hooks, jsx-a11y, unicorn, perf, etc. `@typescript-eslint/consistent-type-imports` is enforced — use `import type` for type-only imports. Underscore prefix (`_foo`) silences unused-var warnings.
- **TS is strict** with `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`. `verbatimModuleSyntax` means `import type` is mandatory for types — the formatter won't fix this for you.
- **Path alias `@/` → `src/`** is configured per-app in `web/vite.config.ts` and `desktop/frontend/vite.config.ts`. It is not available inside `common/` or `design-system/`.
- **UI primitives come from `@base-ui/react`**, not Radix. When extending design-system components, follow the existing CVA + `cn()` pattern (`design-system/src/utils.ts`). Icons are `lucide-react`. Fonts: JetBrains Mono via `@fontsource-variable/jetbrains-mono`.
- **Styling is Tailwind v4.** `design-system/src/globals.css` is the single source for tokens; web/desktop import it via `@hollowcube/design-system/globals.css`. Tailwind scans source via `@source` directives in that file rather than a `tailwind.config`.
- **Adding a shadcn component:** the design-system has `components.json` pointing at `@hollowcube/design-system/components`. Run `shadcn add` from `design-system/`. The output uses base-ui-style primitives, not Radix.
- **Generated files to leave alone:** `web/src/router.ts` and `desktop/frontend/src/router.ts` are overwritten by `@generouted/react-router`; `desktop/frontend/bindings/**` is generated by Wails and is gitignored/lint-ignored.
- **Commit when work is complete.** Once `typecheck` and `test` are green for a piece of work, create a git commit before considering the task done. Do not push — leave commits local so the user reviews them with `git log`/`git diff` and pushes when ready. Split unrelated fixes into separate commits (one logical change per commit) rather than batching them. Commit messages follow the existing style in `git log` — a `type:` prefix (`fix:`, `feat:`, `chore:`, `refactor:`, …), a one-line subject in the imperative, and a body that explains _why_ (not just _what_). Use a HEREDOC for the message so formatting survives the shell.

## Desktop ↔ Go bridge

- Go entry: `desktop/main.go` embeds `frontend/dist` as the asset filesystem and registers services (e.g. `GreetService` in `desktop/greetservice.go`).
- Window chrome (macOS): transparent title bar with `FullSizeContent: true`, `UseToolbar: true`, `MacToolbarStyleUnifiedCompact`, and `InvisibleTitleBarHeight: 38` — the React-side top bar is sized to match.
- Generated TypeScript bindings land in `desktop/frontend/bindings/`. Frontend calls into Go via these bindings; events flow back via `@wailsio/runtime`.
- The desktop frontend uses **hash routing** because it loads from `file://` / Wails asset host — do not switch to browser history routing there.

## Future plans

The architecture is intentionally ahead of the feature set in a few places. Don't delete scaffolding for these:

- **API wiring for files.** `@hollowcube/api` already has `HCClient`, `v1ProjectGet`, `v1ProjectFilesGet/Update/Delete`, and project-event SSE. The files tool currently renders an empty "No files yet" state — its API integration is deferred and will land as its own change. Don't add API calls to the workspace until that work begins.
- **Tool launching.** Tools are currently only seeded via `createInitialWorkspaceState`. An `openTool(toolId)` action (focuses an existing instance or creates one at `defaultLocation`) will be added when more tools and/or a command palette arrive.
- **Editor opening flow.** Editors are registered but nothing dispatches "open file → create editor tab" yet. When a file is selected, the host will look up the editor whose `mimeTypes` includes the file's mime, then call a `state.openEditor({ leafId?, file })` action (to be added).
- **Multi-project navigation.** The active project id flow is the [Active project id](#active-project-id) section above. What's not yet built: a recent-projects list, an in-app project picker, and the project-list API endpoint that would feed it. The desktop launcher is the only project picker today and reads from a stub (`desktop/frontend/src/launcher/useProjects.ts`).
- **Filesystem sync (desktop).** Wails-side sync of the project tree to the local filesystem is planned so users can edit files in external programs (e.g. textures in Aseprite). Lives in `desktop/main.go` + bindings when it arrives.
- **More tools / editors.** Adding either is a localized change: drop a new `ToolDefinition` / `EditorDefinition` under `project/tools/` or `project/editors/` and register it in the `TOOLS` / `EDITORS` arrays in `ProjectWorkspace.tsx`.
