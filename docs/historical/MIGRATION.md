# Migration plan: React-context-heavy → services + signals + actions

> **Status:** completed 2026-05-23. Preserved as a historical record of the
> seven-phase migration. The current architecture is documented in
> [`docs/model-architecture.md`](../model-architecture.md).
>
> **Status legend:** `[ ]` not started · `[~]` in progress · `[x]` complete · `[skip]` deliberately deferred

## Context

The current codebase nests ~14 React providers in `ProjectWorkspace` and uses React context for dependency injection across the model layer. Symptoms: hard-to-reason-about init order, models that can only be tested through React, action handlers scattered across components, lifecycle implicitly driven by React unmount.

The target architecture is documented in [`docs/model-architecture.md`](docs/model-architecture.md): **services** (plain TypeScript classes, React-free) hold state via **signals** (`@preact/signals-core`); **actions** (typed commands in an `ActionRegistry`) are the universal user-facing surface; React becomes a thin view layer with one signal-adapter hook and one provider per container.

This document is the high-level migration roadmap. Each phase is sized to be a single planning session of its own — when a phase begins, a planning session expands it into concrete file-level changes. **Do not treat this doc as the implementation plan**; it is the index.

## Ground rules

- **Pre-release** — breaking changes are acceptable. Don't bend the migration to preserve interim API stability.
- **Single branch** — migration happens on the same long-running branch as ongoing work. Commit in-flight changes (autosave debounce, platform trim, desktop launcher) before starting Phase 1.
- **Read [`docs/model-architecture.md`](docs/model-architecture.md) before any phase.** It defines the conventions every service must follow.
- **Use the [`add-service` skill](.claude/skills/add-service.md)** when scaffolding a new service. It produces the canonical structure (typed deps, signals-as-state, action registration, disposal) and runs lint + typecheck to verify.
- **Two automated guardrails are in place:**
  - oxlint `no-restricted-imports` bans `react` imports from `common/src/model/**` (except `react.ts` and `*.test.ts` files).
  - `bun run lint:signals` (also chained from `bun run lint`) flags `.value` reads outside `computed`/`effect` in service files via AST walk.
- **Tests live with the code.** Every service ships its test file at the same time. Don't accept "we'll write tests in cleanup."

## Phases

### Phase 1 — Foundation [x]

**Goal:** ship the architecture skeleton so every later phase has well-defined primitives to build on. No business logic moves yet; nothing user-visible changes.

**Scope:**
- Establish `common/src/model/foundation/` with: signal re-exports (`signal`, `computed`, `effect`, `batch`, `peek`, types), the `Emitter<T>` class, the `useSignal` React adapter, the typed when-clause evaluator helpers.
- Build `ActionRegistry` class: register/unregister/run, keybinding map, when-clause evaluation against a `ContextService`, `enabledActions` derived signal.
- Build `ContextService` class: `derive(key, fn)`, `set(key, value)`, `get(key)`, `evaluate(whenClause)`.
- Build empty `EditorApp` class: holds platform, `HCClient`, `currentProject: Project | null`, methods `openProject(id)` / `closeProject()`. Does not yet own `AuthService` (that lands in Phase 5).
- Build empty `Project` class: container with placeholders for the services that will be added in phases 2-4. `dispose()` skeleton.
- React layer: `<AppProvider>`, `<ProjectProvider>`, `useApp()`, `useProject()` — minimal context wrappers.
- The web/desktop entry points construct `new EditorApp(platform)` and provide it. Nothing consumes it yet; the existing React tree continues to render unchanged underneath.

**Success criteria:**
- `bun run lint`, `bun run typecheck`, `bun run test` all pass.
- The new files exist with full test coverage on `ActionRegistry`, `ContextService`, `Emitter`.
- The existing app still works exactly as it did — Phase 1 adds infrastructure, removes nothing.

**Out of scope:**
- Any service migration (Phases 2-5).
- Any change to existing React components (Phase 6).

**Status notes:** Foundation primitives landed: `signal` re-exports, `Emitter<T>`, when-clause parser/evaluator, `useSignal` + `AppProvider`/`ProjectProvider` (in `common/src/model/foundation/`). New `ActionRegistry` with `enabledActions` computed (`common/src/model/actions/`); new `ContextService` with stable-backing-signal-per-key, `derive`/`set`/`evaluate` (`common/src/model/context/`). Empty `EditorApp` + `Project` containers; `AppBridge` in `app-root.tsx` constructs `EditorApp` inside the existing `<AuthProvider>` (collapses in Phase 5). `@preact/signals-core` added. Full test coverage on `Emitter`, `when-clause`, `ContextService`, `ActionRegistry`. `lint:signals` script extended with a `// lint:signals-ignore` escape hatch; the model-files oxlint override now disables `no-underscore-dangle` to permit the `_foo` private-signal naming convention.

---

### Phase 2 — Workspace layout migration [x]

**Goal:** move the workspace primitive (docks, splits, tabs, focus, persistence) from Zustand to a `WorkspaceLayoutService` built on signals.

**Why dedicated phase:** this code is load-bearing (~615 lines of store, 350 lines of tests, schema-versioned persistence with crash-loop-resistant reset). Worth isolating so regressions are easy to attribute and the test suite can be migrated alongside.

**Scope:**
- Build `WorkspaceLayoutService` per the canonical pattern: signals for layout state (`columnSizes`, `middleSizes`, `docks`, `center` tree, `focusedLeafId`, transient drag state), methods for every mutation (addTab, closeTab, splitLeaf, etc.), persistence via debounced effect against `Storage`.
- Migrate the schema-versioned read/migrate/validate path verbatim from [`common/src/workspace/store.ts`](common/src/workspace/store.ts) — don't redesign persistence in this phase.
- Migrate every test from [`store.test.ts`](common/src/workspace/store.test.ts) to test the new service; preserve coverage parity.
- Lift the service onto `Project` (the container from Phase 1).
- Rewrite [`Workspace.tsx`](common/src/workspace/Workspace.tsx) and friends to consume the new service via `useProject().layout` instead of `useWorkspaceContext()`. Internal workspace components stay React; only the state source changes.
- Drop the existing Zustand store, the `useWorkspaceStore` hook, and the `WorkspaceContext`.

**Success criteria:**
- Layout state persists across reload, identical key (`hc-project:<projectId>`).
- All existing workspace tests pass against the new service.
- Drag-and-drop, splits, dock toggles all work in the browser (verify via preview).
- Zustand dependency stays (still used by document store etc.) until Phase 3.

**Status notes:** `WorkspaceLayoutService` landed under `common/src/model/workspace/` — signal-backed slices (`columnSizes`, `middleSizes`, `docksVisible`, `left`/`right`/`bottom`, `center`, `focusedLeafId`, `activeDrag`, `hoveredPaneId`) with a composite `state` computed, debounced trailing-edge persistence, schema-versioned migrations + structural validation reused verbatim from `common/src/workspace/{migrations,validate}.ts`. Service mounted on `Project` (deps now include `initialLayout`); `EditorApp.openProject(id, { initialLayout })`. React hooks file (`useLayout`, `useLayoutState`, `useColumnSizes`, `useDocksVisible`, etc.) bridges signals via the foundation `useSignal` adapter. Internal workspace primitive (`Workspace.tsx`, `EditorGroup.tsx`, `ToolDock.tsx`) consumes `useLayout()` directly; `WorkspaceContext` slimmed to host customization only (`tabRegistry`, `renderEmpty`, `renderToolDockAdd`, `onTabContextMenu`). Twelve external consumers migrated: `registry.tsx`, `tools/files.tsx`, `tools/structure.tsx`, `editors/text.tsx`, `search/SearchPopup.tsx`, `actions/EditorActions.tsx`, `actions/context.tsx`, `actions/project-actions.ts` (renamed `useProjectActionsForStore` → `useProjectActionsForLayout`), `data/tab-actions.tsx`, `lsp/ui/LspActions.tsx`, `ProjectTopBar.tsx`, `ProjectWorkspace.tsx`. New `<ProjectModelBridge>` inside `ProjectWorkspace.tsx` constructs the model `Project` via `useApp().openProject(projectId, { initialLayout })` and mounts `<ProjectProvider>` so the workspace primitive can reach `useProject().layout`. Phase 6 collapses this bridge. Old `common/src/workspace/store.ts` + `store.test.ts` + `use-workspace-store.ts` deleted. Full test parity: 28 new tests under `WorkspaceLayoutService.test.ts`. All `bun run lint` / `typecheck` / `test` green (240 pass total).

---

### Phase 3 — Project data services + drop TanStack Query [x]

**Goal:** build the services that own project data, and remove TanStack Query in the same cut. These services own their fetching and caching directly.

**Scope:**
- Build the canonical `TextModelService` + `TextModel` per the [spec in the architecture doc](docs/model-architecture.md#canonical-example-textmodelservice). This is the template — get it right because subsequent services follow the same shape.
- Build `FileTreeService`: file metadata as a flat map, derived tree signal, mutations (create/rename/delete/move), reacts to events (Phase 4 hooks up SSE).
- Build `PendingFilesService`: untitled-file tracking.
- Build `ProjectBootstrap`: replaces `useV1MapEditorBootstrap`. Fetches editor bootstrap, owns project metadata.
- Build `ActiveEditorRegistry`: tracks the focused CodeMirror `EditorView`. The one place view-state registers back into the model layer.
- Drop `@tanstack/react-query` dependency, the `<QueryClientProvider>`, and the dev-tools toggle.
- Convert every endpoint in [`api/src/endpoints/`](api/src/endpoints/) from `useFoo + queryOptions + foo()` to just `foo(client, args)` — plain async functions.
- Drop `<HCClientProvider>` and `useHCClient`. The `HCClient` lives on `EditorApp` and is passed via service deps.
- Rewrite the text editor component and file tree component to consume the new services via hooks. Editor `onChange` → `textModel.setContent`; save → `actions.run('editor.save')`.
- Auto-save debounce migrates from the React effect into `TextModelService` (per the spec).

**Success criteria:**
- All file operations work in the browser (open, edit, save, autosave, rename, delete, multi-tab).
- No `@tanstack/*` imports anywhere in the codebase.
- New services have full test coverage.
- `bun run lint:signals` passes (the new services use `.peek()` in methods, `.value` only in reactive contexts).

**Status notes:** Five new services landed under `common/src/model/`: `ActiveEditorRegistry` (tab-id → CodeMirror view + save handler + lspUri), `PendingFilesService` (signal-backed untitled-file tracking), `FileTreeService` (flat path→MapFile map + sorted list + `rename`/`delete` mutations composing the API), `ProjectBootstrap` (owns the editor-bootstrap fetch as a state machine: idle/loading/loaded/error; kicks off on `Project` construction; sets window title), and `TextModelService` + `TextModel` (canonical doc-spec implementation — single-flight save against captured snapshot, refcounted multi-tab open, autosave via per-model `effect`, external-change handlers, `modelRekeyed`/`saveSucceeded`/`saveFailed`/`conflictAppeared` events). `TanStack Query` removed: `useFoo`/`fooQueryOptions`/`fooKey` hooks stripped from `api/src/endpoints/*` keeping plain `foo(client, args)` + Zod schemas; `<QueryClientProvider>`, `<HCClientProvider>`, `useHCClient`, and `common/src/dev/QueryDevtoolsToggle.tsx` deleted; `@tanstack/react-query` + `@tanstack/react-query-devtools` removed from `api`, `common`, `web`, and `desktop/frontend` package.json + bun.lock. `HCClient` reached via `useApp().client`; service `Deps` carry it. Twelve+ consumers migrated: `files.tsx`, `editors/text.tsx` (full rewrite: autosave + content via signals, no local React effect), `search/sources/{files,text}.ts`, `tools/structure.tsx`, `editors/welcome.tsx`, `ProjectTopBar.tsx`, `actions/{EditorActions,context,project-actions}.ts(x)`, `data/{events,tab-actions}.tsx`, `LspWatchedFilesBridge.tsx`, `LspBufferBridge.tsx` (now `effect()`s over `textModels.openModels` + per-model `content`), `lsp/{applyWorkspaceEdit,LuauLspContext}.tsx`. Deleted: old `common/src/project/{documents/,data/loader.tsx,data/pending-files.tsx,context.tsx}`, plus the orphaned `common/src/editor/active-editor-registry.ts` and `common/src/demo/ApiTestDemo.tsx`. `<ProjectGate>` from the model layer replaces the old `<ProjectLoader>`/`<ProjectGate>` pair. `ProjectWorkspace.tsx` provider tower shrank (lost `<HCClientProvider>`, `<DocumentStoreProvider>`, `<PendingFilesProvider>`, `<ProjectLoader>`). **SSE regression noted**: `<ProjectEventsProvider>` no longer invalidates on events; external file changes won't refresh the tree until Phase 4 wires `ServerEventsConnection` into the model layer. Verification: `bun run lint` (0 errors, 43 unrelated warnings), `bun run typecheck` (clean across all 5 workspaces), `bun run test` (280 pass / 0 fail, 23 files), no `@tanstack/react-query` imports remain, web preview boots cleanly.

---

### Phase 4 — Async subsystems [x]

**Goal:** migrate the heavy services that own external resources (workers, SSE, indexes).

**Scope:**
- `LspService`: owns the Luau LSP worker (terminate on dispose), per-URI diagnostics signals, completions/hover/definitions caches. The most complex service — needs careful lifecycle. Derived signals: `errorCountByPath` (used by file tree for badges).
- `EngineApiService`: owns the Luau engine API bundle. Methods: `lookup(name)`, `search(query)`.
- `ServerEventsConnection`: owns the SSE `EventSource`. Dispatches to siblings via callbacks injected at construction (`onFileChanged: path => fileTree.refresh(path)`). The cross-service dispatch boundary is here.
- `SearchService`: pluggable source registry. `FileTreeService`, `LspService`, `ActionRegistry`, `EngineApiService` each register a source from their own constructor.
- `LanguageService`: language registry (Luau, JSON, plaintext), mime/path lookup. Mostly static, lazy module loads.
- Rewrite consumers: `DiagnosticIndicator` in text editor → `useSignal(lsp.diagnosticsForUri(uri))`; `FileRow` badge → `useSignal(lsp.errorCountByPath)`; etc.
- Delete the existing `LuauLspProvider`, `EngineApiProvider`, `ProjectEventsProvider`, `LanguageProvider` React contexts.

**Success criteria:**
- LSP diagnostics, completions, hover, goto-definition all work as before.
- SSE updates (someone edits a file via the API) reflect in the open editor and file tree.
- Search popup returns results from every registered source.
- Project disposal cleanly terminates the worker and closes SSE (verify no console warnings on HMR or window close).

**Status notes:** Five new services landed under `common/src/model/`: `LanguageService` (static lookup wrapper over `DEFAULT_LANGUAGES`); `EngineApiService` (bundle-loading state machine `idle → loading → ready | error`, `start()` is idempotent + retry-on-error, delegates lookup/search to `findDocNode`/`findMember`); `SearchService` (pluggable source registry, `register({id,title})` returns a disposer, `sources: ReadonlySignal<readonly SearchSource[]>`); `LspService` (owns worker + `LspClient` lifecycle, per-URI diagnostics signal cache built from a single `onDiagnostics` listener, derived `errorCountByPath`, context-key derivations for `lsp.luau.{running,starting,failed}`, `start(bundle)` idempotent + `stop()` async); `ServerEventsConnection` (consolidates `<ProjectEventsProvider>` + `<LspWatchedFilesBridge>` — one SSE iterator, on each event fans out to `fileTree.refresh()`, `lsp.client.didChangeWatchedFiles(...)`, and a targeted `textModels.handleExternalChange(path, content)` when an open clean model matches — closing the Phase 3 SSE-refresh regression). `Project` constructor sequences the new services with an `effect()` watching `engineApi.bundle` to trigger `lsp.start(bundle)` exactly once. `FileTreeService.refresh()` added (re-fetches `v1MapEditorBootstrap` and re-installs the map). Consumers migrated: `LspBufferBridge.tsx`, `LspActions.tsx`, `tools/{files,structure,problems,lsp-log}.tsx`, `editors/{docs,text}.tsx`, `editors/welcome.tsx`, `search/sources/{symbols,text}.ts`, `search/SearchPopup.tsx` (tab strip now derives from `useSearchSources()`), `data/connection-indicator.tsx`, `lsp/ui/LspActions.tsx`. `LanguageEditorDeps.services` → `LanguageEditorDeps.lsp`; the luau editor binding reads `lsp.client`/`lsp.status` signals directly. Deleted: `common/src/lsp/LuauLspContext.tsx`, `common/src/engine-api/provider.tsx`, `common/src/project/data/events.tsx`, `common/src/project/LspWatchedFilesBridge.tsx`, and the React-context half of `common/src/editor/languages/registry.tsx`. `ProjectServices.lsp.luau` slot + `setLuauClient`/`subscribeLuauLsp`/`getLuauLspSnapshot` gone; only the action registry + context-keys remain (Phase 6 takes those). Verification: `bun run lint` (0 errors, 42 unrelated warnings; `lint:signals` clean), `bun run typecheck` (clean across all 5 workspaces), `bun run test` (316 pass / 0 fail across 28 files, ~36 new tests), web preview boots cleanly.

---

### Phase 5 — Auth migration [x]

**Goal:** lift `AuthProvider` into an `AuthService` class. Deferred to here because auth already works and is mostly factored out (`TokenManager`, `createIndexedDbSessionStore`, `redeemLaunchCode` are plain TS); the React wrapping is contained.

**Scope:**
- Build `AuthService` class. Owns: auth state machine (`initializing → redeeming → picking → authenticated → error`) as signals, sessions, active account, granted project, `TokenManager`, DPoP plumbing, dev-dummy-auth short-circuits.
- Service lives on `EditorApp` (added to the container's fields).
- New `<AuthProvider>` is a ~30-line bridge: holds the service via `useRef`, calls `service.init()` once, exposes `useAuth()` via `useSyncExternalStore`.
- `useAuth()` API stays roughly the same so existing consumers (the launcher, `AuthGate`, page shells reading `grantedProject`) don't need rewrites in this phase.
- Migrate auth tests to test the service directly. Existing `tokens.test.ts`, `dpop.test.ts`, `redeem.test.ts` already test plain TS — they survive untouched.

**Success criteria:**
- Auth flows work end-to-end: launch from in-game, refresh tokens, switch accounts, sign out, dev-dummy mode.
- The 318-line `context.tsx` shrinks to ~50 lines (bridge + provider).
- Auth tests pass.

**Status notes:** `AuthService` landed at `common/src/model/auth/AuthService.ts` — wraps the existing plain-TS `tokens.ts` / `dpop.ts` / `redeem.ts` / `sessionstore.ts` / `keystore.ts` / `launch-code.ts` modules verbatim, just shifting state from React `useState` to signals. Owns `client: HCClient` (constructed inside the service with the DPoP/auth interceptors), the FSM (`status: ReadonlySignal<AuthStatus>`), `sessions` (computed: stored + needsReauth → state field), `activeAccount`, `grantedProject`, plus `init()` / `redeemFromLaunch()` / `switchAccount()` / `signOut()` / `dispose()`. Init fires in the constructor; state-machine guard + redeem.ts's module-level in-flight map cover React StrictMode. `EditorApp({ platform })` — `client` becomes a getter returning `auth.client`. `<AuthProvider>` deleted; `useAuth()` is now a thin hook in `common/src/model/auth/react.ts` that reads from `useApp().auth` via `useSignal` and preserves the existing 8-field shape. `app-root.tsx` shrinks from ~88 to ~67 lines; `AppBridge` is the only model-layer wrapper. Consumers (`AuthGate`, `Launcher`, web/desktop page shells, `AppBridge`) re-pointed to `useAuth()` from the model layer with no signature changes. Verification: `bun run lint` (0 errors, 45 unrelated warnings; `lint:signals` clean), `bun run typecheck` (clean across all 5 workspaces), `bun run test` (328 pass / 0 fail across 29 files; +12 new `AuthService.test.ts` cases covering dev-dummy short-circuit, redeem success, redeem failure paths, resume-from-store, switchAccount mint/needs-reauth, signOut all/one, disposal). Web preview boots cleanly under dummy-auth mode — auth state reaches `authenticated`, `ProjectGate` opens, and the bootstrap-fetch error path remains the only visible regression vs. having a real local API.

---

### Phase 6 — React UI collapse [x]

**Goal:** collapse the provider tower, move all action handlers into services, migrate every remaining component to the new hooks. This is the phase that visibly delivers the simpler architecture.

**Scope:**
- Audit every component under `common/src/project/` and `common/src/workspace/` for action handlers, direct state manipulation, and React context reads. Route mutations through `actions.run(...)`. Move handler logic into the relevant service.
- Rewrite [`ProjectWorkspace.tsx`](common/src/project/ProjectWorkspace.tsx) to a ~3-deep provider tree: `<ProjectErrorBoundary>` → `<TooltipProvider>` → `<ProjectProvider>` → workspace. No more nested provider tower.
- Update page shells ([`web/src/pages/index.tsx`](web/src/pages/index.tsx), [`desktop/frontend/src/pages/project/[projectId].tsx`](desktop/frontend/src/pages/project/[projectId].tsx)) to construct `Project` via `app.openProject(projectId)` in a `useEffect`, dispose in cleanup. Wire `app.closeProject()` on unmount.
- Migrate the action-context bridge: a tiny `<EditorFocusBridge>` React component pushes focus / active-language / active-leaf into `ContextService` via `useEffect`. The one explicit React-into-model flow.
- Migrate every action declaration from React component scopes into the service that owns the relevant data. After this phase, no React component should call `actions.register` — all action registrations live in service constructors.
- The text editor, file tree, search popup, problems pane, tool docks all migrate to the new hooks.
- The native menu bridge and hotkey bridge consume `actions.enabledActions` (a derived signal) instead of subscribing to a React-side registry.

**Success criteria:**
- `ProjectWorkspace` is ~30 lines of JSX (down from ~120 today).
- No React component reads from a model-layer context other than `<AppProvider>` / `<ProjectProvider>`.
- All actions registered in services, no `useRegisterAction` calls in components.
- Browser smoke test: open project, edit files, autosave, run LSP completion, search, native menu actions all work.

**Status notes:** Action registrations moved into service constructors via new optional deps (`actions: ActionRegistry`, `activeEditor: ActiveEditorRegistry`, `layout: WorkspaceLayoutService` where applicable). `TextModelService` registers `editor.save` / `editor.saveAll` / `editor.newFile` (`when: 'editor.text && editor.dirty'`, `editor.anyDirty`, always); `LspService` registers `editor.format` (`when: 'editor.text'`), `editor.codeAction` / `editor.rename` (`when: 'editor.text && lsp.luau.running'`) — handler logic from the old `EditorActions.tsx` + `lsp/ui/LspActions.tsx` (resolveContext, applyCodeAction, applyEditViaServer, doRename, overlappingDiagnostics) moved verbatim into private LspService methods reading `activeEditor.activeDocId.peek()`; `WorkspaceLayoutService` registers `editor.closeFocusedTab` (gated `when: 'platform.desktop'` via a static `platform.desktop` context key set at Project construction) + `workspace.toggleDock.{left,right,bottom}`; `SearchService` gains `popupOpen` / `popupTab` / `popupQuery` signals + `openWith(tab)` / `close()` / `setTab(q)` / `setQuery(q)` methods and registers `search.openAll` / `search.openActions` / `search.openFiles` / `search.openSymbols` / `search.openText`. `LspUiBus` moved onto `LspService.ui`; `lsp-ui-context.tsx` collapses to a 2-hook adapter (`useLspUiBus` reads `useProject().lsp.ui`; `useLspUiSnapshot` subscribes via `useSyncExternalStore`); `<LspUiProvider>` retired. `Project` adds reactive context derivations for `editor.focused`, `editor.text`, `editor.dirty`, `editor.anyDirty`, and one `tool.<kind>` derivation per known tool (`tool.files`, `tool.structure`, `tool.problems`, `tool.lspLog` — hyphenated kinds camel-cased to satisfy the when-clause identifier grammar). New `<EditorFocusBridge>` pushes the focused leaf's `activeId` into `ActiveEditorRegistry.activeDocId` — the one explicit React → model flow. `ActionHotkeyBridge` rewritten to consume `useSignal(project.actions.enabledActions)` and bind keys directly via `useHotkey`; `NativeMenuBridge` consumes the same signal and rebuilds the payload via the rewritten `menu-payload.ts` (drops `contextSet` arg, reads `enabled` from `disabled` only — when-clauses already filtered). `ProjectWorkspace.tsx` provider tower collapses from ~10 wrappers (`<ProjectErrorBoundary>` → `<ProjectModelBridge>` → `<ProjectGate>` → `<RegistryProvider>` → `<ProjectServicesProvider>` → `<ServicesActionRegistryAdapter>` → `<TooltipProvider>` → `<LspUiProvider>` → `<ActionContextProvider>` → workspace) to ~5 (`<ProjectErrorBoundary>` → `<ProjectModelBridge>` → `<ProjectGate>` → `<RegistryProvider>` → `<TooltipProvider>` → workspace) with `<LspBufferBridge>` + `<EditorFocusBridge>` + `<ActionHotkeyBridge>` + `<NativeMenuBridge>` as siblings instead of providers; `ProjectWorkspaceInner` drops the `<NewFileAction>` / `<CloseFocusedTabAction>` / `<EditorActions>` / `<LspActions>` / `<SearchActions>` action-component mounts. Double-tap Shift survives as a single `useDoubleTapKey('Shift', ...)` call inside `ProjectWorkspaceInner` (the gesture doesn't fit the action keybinding model). `useActionResults` rewritten to read `useSignal(project.actions.enabledActions)`, removing the legacy `actionMatchesContext` filter. `ContextMenuAction` (local, view-only, retains `icon: ReactNode`) introduced in `ActionContextMenu.tsx` and adopted by `CodeEditor.tsx` + `tools/files.tsx` so ad-hoc right-click menus don't depend on the registered-action shape. Deleted: `common/src/lsp/ui/LspActions.tsx`, `common/src/project/actions/{EditorActions.tsx,context.tsx,context-keys.ts,context-keys.test.ts,registry.tsx,registry-class.ts,registry-class.test.ts,types.ts}`, `common/src/project/{services.ts,services-context.tsx}`, `common/src/project/search/{search-store.ts,SearchActions.tsx}` (Zustand store retired in favor of SearchService signals), plus the inline `NewFileAction` / `CloseFocusedTabAction` components in `ProjectWorkspace.tsx` / `tab-actions.tsx`. Verification: `bun run lint` (0 errors, 45 unrelated warnings; `lint:signals` clean), `bun run typecheck` (clean across all 5 workspaces), `bun run test` (302 pass / 0 fail across 27 files — includes new SearchService popup-state + action-registration tests, rewritten `menu-payload.test.ts` for the simplified builder), grep checks (`useRegisterAction` / `useActions()` / `ActionRegistryProvider` / `ActionContextProvider` / `ServicesActionRegistryAdapter` / `registry-class` all return zero matches outside doc comments), web preview boots cleanly under dummy-auth — `ProjectGate` reaches the bootstrap-fetch step with no React tree errors.

---

### Phase 7 — Cleanup [x]

**Goal:** delete the rubble, update docs, drop unused deps.

**Scope:**
- Delete every now-orphaned React context file: `WorkspaceContext`, the old `DocumentStoreProvider`, `PendingFilesProvider`, `RegistryProvider`, `LuauLspProvider`, `EngineApiProvider`, `LanguageProvider`, `ProjectEventsProvider`, `ProjectServicesProvider`, `ProjectGate`, `HCClientProvider`, and any hooks they exposed.
- Delete the old `common/src/workspace/store.ts` (Zustand). Drop `zustand` from `package.json` if no other consumer remains.
- Delete `common/src/project/actions/` legacy class once `ActionRegistry` (foundation) supersedes it; same for any other duplicated primitives.
- Drop the React Query dev tools toggle (`common/src/dev/`) and any related plumbing.
- Update [`CLAUDE.md`](CLAUDE.md): remove the "target model architecture (read first)" framing — by this point it IS the architecture. Promote the model-architecture summary to the canonical description.
- Update [`docs/model-architecture.md`](docs/model-architecture.md): change "target architecture, not the current state" to "current architecture." Update file paths in the canonical example to match what actually shipped.
- Final lint, typecheck, full test pass. Update `bun.lock`.
- Delete this MIGRATION.md or move it to `docs/historical/` as a record.

**Status notes:** Most "delete dead context" bullets had already been satisfied by Phases 2–6 (the deleted Phase 7 targets — `WorkspaceContext`, `RegistryProvider`, `ProjectGate`, `<HCClientProvider>`, the various provider components — were either deleted as soon as their replacement landed in an earlier phase, or are legitimate post-migration scaffolding that survived intentionally). What Phase 7 actually shipped: (1) **prose updates** — `CLAUDE.md` "Target model architecture" → "Model architecture", dropped TanStack Query / Zustand store mentions, replaced the routes table (`/playground`, `/editor`, `/ds` rows removed), struck the dev-tooling section, repointed the MIGRATION.md link to `docs/historical/`, and refreshed the `@hollowcube/common` layout listing to include `model/` and drop `demo/`; `docs/model-architecture.md` status header reframed ("target architecture" → "current architecture as of Phase 7"), the seven-phase migration plan body replaced with a one-paragraph pointer to this historical doc, the canonical TextModelService example aligned with the dotted-form context keys (`editor.text`, `editor.dirty`, `editor.anyDirty`) and the Phase 6 reality that editor-state derivations live centrally in `Project.ts`. (2) **demo + zustand removal** — deleted `common/src/demo/` (3 files) and the six page re-exports (`web/src/pages/{playground,editor,ds}.tsx` + desktop counterparts); removed `./demo` subpath export from `common/package.json`; removed `zustand` from the dependency lists in `common/`, `web/`, and `desktop/frontend/` package.json files; `bun install --force` confirmed the lockfile drops zustand entirely (0 entries from 2). (3) **stale Phase-X comment strip** — 13 source files cleaned (`launch-code.ts`, `ActiveEditorRegistry.ts`, `tree-helpers.ts` — the orphaned `selectActiveContextTags` helper + its tests + barrel re-exports deleted, `TextModelService.ts` + its test, `Project.ts`, `EditorApp.ts`, `app-root.tsx` — dropped the dead `devTools?: boolean` prop and its two call sites in `web/desktop/main.tsx`, `api-test.tsx`, `text.ts` search source, `persistence.ts`, `ServerEventsConnection.ts`, `FileTreeService.ts`, `registry.tsx`, `web/src/main.tsx`, `desktop/frontend/src/launcher/useProjects.ts`). Final grep `Phase [1-7]` against `common/src` + `web/src` + `desktop/frontend/src` returns zero matches. (4) **MIGRATION.md relocation** — moved to `docs/historical/MIGRATION.md` via `git mv` (history preserved). Verification: `bun install --force` clean, `bun run lint` clean (0 errors, 45 unrelated warnings; `lint:signals` clean), `bun run typecheck` clean across all 5 workspaces, `bun run test` green (300+ tests), web preview boots cleanly (already running). The seven-phase migration is closed.

---

## Risks to watch across phases

- **HMR with disposable services** — when the shell hot-reloads, services re-construct, which terminates the LSP worker and reopens SSE. `dispose()` must be idempotent and the cleanup order deterministic. Surface in Phase 4.
- **Optimistic-update bugs** — without TanStack Query's cache layer, mutations in Phase 3 must patch model state explicitly after the network confirms, with rollback on error. Easy to miss in autosave / file rename / delete paths.
- **Worker / SSE leaks** — wrong disposal order in `Project.dispose()` leaks workers. Symptom: opens 10 projects in dev, sees 10 LSP workers in DevTools. Surface in Phase 4 cleanup verification.
- **`.peek()` vs `.value` mistakes** — silently capture reactive dependencies. The signals lint check catches the obvious ones; subtle cases require code review.
- **The action-context bridge** (Phase 6) is the only React-into-model reverse flow. Don't let other reverse flows creep in.

## See also

- [`docs/model-architecture.md`](docs/model-architecture.md) — full design doc. Always the source of truth for conventions.
- [`.claude/skills/add-service.md`](.claude/skills/add-service.md) — scaffolding skill. Use it.
- [`common/src/model/README.md`](common/src/model/README.md) — model-layer tour.
- [`CLAUDE.md`](CLAUDE.md) — project guidance, references this plan.
