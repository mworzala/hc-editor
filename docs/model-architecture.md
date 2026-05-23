# Model architecture

> **Status:** target architecture, not the current state of the code. The current
> codebase is React-context-heavy with a deeply nested provider tower.
> This document describes where we are going.

## TL;DR

The editor is built on three primitives:

1. **Services** — plain TypeScript classes that own state and behavior. React-free.
2. **Signals** (`@preact/signals-core`) — fine-grained reactive state on services. The only way state is exposed.
3. **Actions** — a registry of named commands. Every UI interaction routes through it.

Services compose by containment (`Project` contains `TextModelService`, `LspService`, …). React is a thin view layer: one provider hands the model down, and tiny hooks subscribe components to signals. There is **no Redux-style store**, no global state tree, and no React context inside the model layer.

Service methods do work; actions are the public command surface. UI invokes actions; tests can invoke either. State propagates via signals; one-shot events propagate via a small `Emitter` class.

---

## Why this architecture

### What we are escaping

The previous architecture nested ~14 React providers in `ProjectWorkspace` and used React context for dependency injection. Symptoms:

- Hard to reason about init order ("which provider needs to be above which?").
- Models could only be tested by mounting the React tree.
- Cross-cutting state (file × diagnostics × dirty) required threading hooks through layers.
- Action handlers lived in arbitrary components, not in the services that owned the data.
- Lifecycle was implicit (React unmount drives disposal, sometimes wrong).

### What this architecture buys

- **Testability.** Each service is a class. `new TextModelService(deps)` + call methods + assert signal values. `bun test`, no JSDOM.
- **Clarity.** State lives where data lives. Actions live where behavior lives. No central tree to reason about.
- **Composition.** `Project` is a container of services. New service is one file plus a registration in the container.
- **Decoupling from React.** The whole model layer could run in a Node script, a worker, or a CLI. React is one possible view.
- **Fine-grained reactivity.** Signals re-render only the components that read the changed signal. No "store changed, re-render everything that subscribes to it."

### What this architecture is NOT

- Not Redux. No central store, no reducers, no actions-as-objects-dispatched-to-reducer.
- Not Apollo. No normalized cache, no query language. (Considered and rejected — see the "Normalized cache" discussion below.)
- Not full XState. State machines are used where a subsystem genuinely is one (auth, LSP lifecycle, project bootstrap), not as the universal pattern.
- Not full event-sourcing. Events are notifications, not the source of truth.

---

## The three primitives

### 1. Signals — `@preact/signals-core`

The reactive state primitive. ~1.8kb, mature, handles diamond dependencies, batching, lazy evaluation, and dynamic dependency tracking.

```ts
import { signal, computed, effect, batch } from '@preact/signals-core'

const count = signal(0)
const doubled = computed(() => count.value * 2)
const dispose = effect(() => console.log('doubled:', doubled.value))

count.value = 1                     // logs "doubled: 2"
batch(() => {                       // batch: subscribers fire once
    count.value = 2
    count.value = 3
})                                  // logs "doubled: 6"
dispose()                           // stop the effect
```

**Two reading idioms:**

- `signal.value` **inside `computed` or `effect`** — registers a reactive dependency.
- `signal.peek()` **inside an imperative method** — reads without subscribing.

Getting this wrong silently captures dependencies you didn't intend. See the [`peek()` discipline](#peek-vs-value-discipline) section.

### 2. `Emitter<T>` — for events that aren't state

Signals are perfect for state ("the current diagnostics for this file are X"). They are wrong for events ("a save just succeeded" — a discrete thing, not a value). For that, a small typed emitter:

```ts
// common/src/model/foundation/emitter.ts
export type Event<T> = (listener: (value: T) => void) => () => void

export class Emitter<T> {
    private listeners = new Set<(value: T) => void>()

    event: Event<T> = (listener) => {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }

    fire(value: T): void {
        for (const l of this.listeners) l(value)
    }

    dispose(): void {
        this.listeners.clear()
    }
}
```

Services expose events as the `event` field, never the `Emitter` itself:

```ts
class TextModelService {
    private _events = new Emitter<TextModelServiceEvent>()
    readonly events = this._events.event   // subscribe; cannot fire from outside
}
```

### 3. `ActionRegistry` — the command bus

Every UI interaction is an action. Actions have:

- `id` — `'editor.save'`, `'files.create'`, `'workspace.toggleLeftDock'`
- `title` — human-readable
- `when?` — a context-key expression like `'editorFocused && editorDirty'`
- `keybinding?` — `'$mod+s'`
- `menu?` — placement metadata
- `run(args?)` — the handler

The registry resolves keybindings, surfaces actions in the command palette, evaluates when-clauses against `ContextService`, and provides `run(id, args)` for programmatic invocation.

**Action handlers live on the service that owns the data.** `editor.save`'s handler is registered by `TextModelService.constructor` and calls `this.save(...)`. `files.delete`'s handler is registered by `FileTreeService`. The registry is just routing.

---

## Service conventions

### Shape

Every service is a class with:

- **Constructor** takes a typed `Deps` interface. No service-locator pattern, no DI container. Just explicit dependencies.
- **State as signals.** Private writable signals (`signal<T>`) with public read-only views (`as ReadonlySignal<T>`).
- **Methods for mutations.** Service methods do the work; they `.peek()` signals and call `.value =` to update.
- **Actions registered at construction.** Save action disposers; `dispose()` calls them.
- **Context keys derived at construction.** Same lifecycle.
- **`Emitter` for discrete events.** Small surface; most consumers should prefer signals.
- **`dispose()`** in reverse order of construction.

### React-freeness

A service module must not import from `react`, `react-dom`, or any React-coupled library. This is the load-bearing constraint of the whole architecture. Enforced by:

- File location: services live under `common/src/model/`, React hooks live in sibling `react.ts` files. Convention then lint rule.
- Future: a lint rule that bans `react` imports from `model/**` files (see [Reinforcement mechanisms](#reinforcement-mechanisms)).

### Composition

Services are composed by containment, not inheritance:

```ts
class Project {
    readonly bootstrap: ProjectBootstrap
    readonly fileTree: FileTreeService
    readonly textModels: TextModelService
    readonly layout: WorkspaceLayoutService
    readonly actions: ActionRegistry
    readonly context: ContextService
    readonly languages: LanguageService
    readonly lsp: LspService
    readonly engineApi: EngineApiService
    readonly search: SearchService
    readonly events: ServerEventsConnection
    readonly activeEditor: ActiveEditorRegistry

    constructor(deps: ProjectDeps) {
        // Construct in dependency order. Disposals run in reverse.
        this.actions = new ActionRegistry()
        this.context = new ContextService()
        this.languages = new LanguageService()
        // ...
        this.textModels = new TextModelService({
            projectId: deps.projectId,
            client: deps.client,
            fileTree: this.fileTree,
            pendingFiles: this.pendingFiles,
            actions: this.actions,
            context: this.context,
            activeEditor: this.activeEditor,
        })
        // ...
    }

    dispose(): void {
        // Reverse order. Events first (no more incoming), then async
        // resources (LSP worker), then sync services.
        this.events.dispose()
        this.lsp.dispose()
        this.textModels.dispose()
        // ...
    }
}
```

### Internal-only methods

`TextModel` has methods that should only be called by `TextModelService`, not by components. TypeScript can't enforce true package-level visibility, but we use a pattern that's almost as strong:

```ts
// common/src/model/text-models/TextModel.ts

// Public interface exposed to consumers.
export interface TextModel {
    readonly id: DocumentId
    readonly content: ReadonlySignal<string>
    readonly dirty: ReadonlySignal<boolean>
    setContent(content: string): void
    discard(): void
}

// Internal interface used by TextModelService.
export interface TextModelInternal extends TextModel {
    commit(savedSnapshot: string): void
    setPath(path: string): void
    setOriginal(value: string): void
    markOrphaned(): void
}

// Factory returns a TextModelInternal (so service can call internal methods),
// but components type it as TextModel via the hook layer.
export function createTextModel(args: CreateTextModelArgs): TextModelInternal {
    // ...
}
```

The service stores `TextModelInternal` in its private map and exposes `TextModel` via `get()`. Components cannot reach internal methods through the type system unless they actively cast. Casts are review-time signals.

### Public vs private signal exposure

```ts
class FooService {
    private _state = signal<State>(initial)
    readonly state: ReadonlySignal<State> = this._state   // consumer-facing
}
```

Consumers can `.value` (read), `effect`/`computed` over it, subscribe — but cannot `.value =` (write). Writes go through service methods.

### Disposal order

`dispose()` is mandatory on every service. The pattern:

1. **Stop incoming work** — cancel timers, abort fetches, close event sources.
2. **Unregister externally visible things** — actions, context keys, menu items.
3. **Dispose internal resources** — workers, observers.
4. **Stop reactive effects** — call effect disposers.
5. **Clear references** — empty maps, null out fields. Signals become unreachable and GC.

`Project.dispose()` calls each service's `dispose()` in reverse construction order. Get this right and HMR / window close / project switch are clean. Get it wrong and you leak workers or fire stale handlers.

---

## `peek()` vs `.value` discipline

This matters enough to spell out:

| Context | Use | Why |
|---|---|---|
| Inside `computed(() => ...)` | `.value` | You want to register a dependency |
| Inside `effect(() => ...)` | `.value` | Same — effect re-runs when these change |
| Inside an imperative method (`save`, `setContent`, action handlers) | `.peek()` | You're reading state, not subscribing. Subscribing here causes the surrounding tracking context (often nothing, sometimes a parent effect) to inadvertently track |
| Inside a React component's render function | via the `useSignal` hook | Hook bridges to `useSyncExternalStore` |
| Inside a React `useEffect` callback | `.peek()` | The React effect manages its own dependencies via the dep array |

A future lint rule will enforce this (see [Reinforcement mechanisms](#reinforcement-mechanisms)). Until then it's a convention worth catching in code review.

**Common bug:**

```ts
async save(docId: DocumentId): Promise<SaveResult> {
    const model = this.models.get(docId)
    if (!model) return { ok: true }
    if (!model.dirty.value) return { ok: true }   // BUG: subscribes whatever effect is on the call stack
    // ...
}
```

The `.value` call here is wrong. The fix is `model.dirty.peek()`.

---

## React layer

The React layer is small and dumb. It does three things:

1. Provide the app / project to the tree via context.
2. Bridge signals to React state via `useSyncExternalStore`.
3. Render components that subscribe to signals and dispatch actions.

### Providers

```tsx
// common/src/model/react.tsx

const AppContext = createContext<EditorApp | null>(null)
const ProjectContext = createContext<Project | null>(null)

export function AppProvider({ app, children }: { app: EditorApp; children: ReactNode }) {
    return <AppContext.Provider value={app}>{children}</AppContext.Provider>
}

export function useApp(): EditorApp {
    const app = useContext(AppContext)
    if (!app) throw new Error('useApp must be inside <AppProvider>')
    return app
}

export function ProjectProvider({ project, children }: { project: Project; children: ReactNode }) {
    return <ProjectContext.Provider value={project}>{children}</ProjectContext.Provider>
}

export function useProject(): Project {
    const project = useContext(ProjectContext)
    if (!project) throw new Error('useProject must be inside <ProjectProvider>')
    return project
}
```

That is the entire React-context surface for the model. Two providers, period.

### Signal → React adapter

```ts
// common/src/model/react.tsx
import { useSyncExternalStore } from 'react'
import type { ReadonlySignal } from '@preact/signals-core'

export function useSignal<T>(s: ReadonlySignal<T>): T {
    return useSyncExternalStore(
        (cb) => s.subscribe(cb),
        () => s.value,
        () => s.value,
    )
}
```

One function. Every consumer goes through it (directly or via a service-specific hook).

### Service hooks

Each service has a `react.ts` sibling with thin hooks:

```ts
// common/src/model/text-models/react.ts
import { useSignal } from '../react'
import { useProject } from '../react'

export function useDocument(docId: DocumentId): TextModel | undefined {
    const { textModels } = useProject()
    return textModels.get(docId)
}

export function useDocumentContent(docId: DocumentId): string {
    const { textModels } = useProject()
    const model = textModels.get(docId)
    // Need to handle the maybe-undefined case in a stable way
    return useSignal(model?.content ?? EMPTY_SIGNAL)
}

export function useAnyDirty(): boolean {
    const { textModels } = useProject()
    return useSignal(textModels.anyDirty)
}
```

These files contain almost no logic. Their job is to expose service signals to React idiomatically.

### Components

Components do four things:

- Call hooks to read signal values.
- Call `actions.run('action.id', args)` to mutate via the command bus.
- Render JSX.
- Manage purely view-local state with `useState` (popovers open, drag visuals, etc.).

Components do not call service methods directly for mutations. They go through actions. This isn't strict — sometimes a service method is the right call (creating a model on mount via `useEffect`) — but for user-initiated work, actions are the path.

---

## `ActionRegistry` and `ContextService`

### Action shape

```ts
export type Action = {
    id: string                              // unique, dotted: 'editor.save'
    title: string                           // human-readable
    keybinding?: string                     // '$mod+s', '$mod+shift+p'
    when?: string                           // 'editorFocused && editorDirty'
    menu?: { path: MenuPath; group: string; order: number }
    run(args?: Record<string, unknown>): void | Promise<void>
}

export class ActionRegistry {
    register(action: Action): () => void    // returns dispose
    unregister(id: string): void
    run(id: string, args?: Record<string, unknown>): void | Promise<void>
    get(id: string): Action | undefined
    list(): readonly Action[]
    enabledActions: ReadonlySignal<readonly Action[]>   // computed: filtered by current context
}
```

### When-clauses

A simple expression language: `&&`, `||`, `!`, parens, identifiers (context keys), equality (`key === 'value'`). Don't over-engineer — VS Code's started simple and grew on demand. A parser is ~100 lines.

### `ContextService` as derived signals

```ts
export class ContextService {
    /** Register a derived context key. The function is wrapped in `computed`,
     *  so it auto-tracks any signals it reads. Returns a dispose. */
    derive(key: string, fn: () => unknown): () => void

    /** Set a context key imperatively. Use for view-state-driven keys like
     *  `editorFocused` that aren't naturally derived from model signals. */
    set(key: string, value: unknown): void

    get(key: string): unknown
    evaluate(whenClause: string): boolean
}
```

Most context keys are `derive` — pure functions of other signals. A few are `set` — pushed in by React (focus state, primarily). Actions evaluate against `evaluate(when)` whenever the registry rebuilds `enabledActions` (which recomputes when any tracked context signal changes).

---

## Full service catalog

App-level (one per process):

| Service | Owns | Notes |
|---|---|---|
| `EditorApp` | `HCClient`, `AuthService`, the current `Project | null`, `platform` | `openProject(id)` / `closeProject()`. Owns the HTTP client across project switches |
| `AuthService` | Auth state machine, sessions, active account, granted project, `TokenManager`, DPoP plumbing | Subsumes today's `AuthProvider` + `tokens.ts` + `redeem.ts` + `sessionstore.ts` + `keystore.ts` |
| `HCClient` | HTTP client | Existing class. Auth interceptors read from `AuthService` |

Project-level (one per open project, disposed on close):

| Service | Owns | Notes |
|---|---|---|
| `Project` | Container of services below | `dispose()` tears down in reverse order |
| `ProjectBootstrap` | Project metadata fetch state | Signals: `status`, `project` |
| `FileTreeService` | File metadata as flat map; tree-shape derived | Methods: `create`, `rename`, `delete`, `move`. Reacts to SSE events |
| `TextModelService` | Open `TextModel` instances, autosave coordinator, save mutation tracker | Canonical example below |
| `TextModel` (per doc) | `content`, `original`, `dirty`, `path` | Multi-tab share via service refcount |
| `PendingFilesService` | Untitled files awaiting save | Signals: `pending` |
| `WorkspaceLayoutService` | Workspace primitive state (docks, splits, tabs, focus) | Persists to `Storage` via `hc-project:<id>` |
| `ContextService` | Context keys for action when-clauses | Mix of derived signals and imperative sets |
| `ActionRegistry` | Action definitions, keybindings, menu structure | The universal command bus |
| `LanguageService` | Language registry, mime/path → language lookup | Mostly static, lazy module loads |
| `LspService` | LSP worker, per-URI diagnostics, completions cache, definitions index | Signals: `status`, `diagnosticsForUri(uri)`, derived `errorCountByPath` |
| `EngineApiService` | Luau engine API bundle for autocomplete docs | Signals: `bundleStatus` |
| `SearchService` | Pluggable search source registry | Each domain service registers its source |
| `ServerEventsConnection` | SSE connection | Dispatches into siblings via injected callbacks |
| `ActiveEditorRegistry` | Tracks focused CodeMirror `EditorView` | The one place view-state registers back into the model layer |

That's the universe. Most services are 100-300 lines.

---

## Where editor state lives

This question comes up enough to spell out:

| Layer | Owns | Examples |
|---|---|---|
| `TextModel` (model, per document) | Content, original, dirty | `content: ReadonlySignal<string>`, `dirty: ReadonlySignal<boolean>` |
| `LspService` (model, per project) | Diagnostics by URI, completions, hover, definitions, worker | `diagnosticsForUri(uri): ReadonlySignal<readonly Diagnostic[]>` |
| `FileTreeService` (model) | Per-file derived diagnostic counts | `errorCountByPath: ReadonlySignal<ReadonlyMap<string, number>>` (computed from `LspService`) |
| CodeMirror `EditorView` (view, per mounted editor) | Cursor, selection, scroll, folds, decorations, popups | View state. Lives in CodeMirror, not in our services |

Two tabs of the same file share one `TextModel` (content) and have two independent `EditorView`s (cursors, scroll).

### Diagnostics flow

```
LSP worker  →  LspService._diagnosticsByUri.set(uri, signal)
                ↓
           lsp.errorCountByPath = computed(() => aggregate)
                ↓
   FileTreeRow subscribes via useSignal(lsp.errorCountByPath)
   CodeMirror diagnostics extension subscribes via lsp.diagnosticsForUri(uri).subscribe(...)
```

The file tree row re-renders only when the count for its path changes (fine-grained reactivity). The CodeMirror extension dispatches a CM transaction with updated decorations when diagnostics change.

### The CodeMirror wiring component

```tsx
function TextEditor({ docId, lspUri }: Props) {
    const { textModels, lsp } = useProject()
    const model = textModels.getOrOpen(docId, /* initialContent from fetch */ '')
    
    return (
        <CodeMirrorHost
            initialContent={model.content.peek()}
            contentSignal={model.content}             // model → view (external edits)
            onChange={(text) => model.setContent(text)} // view → model
            diagnosticsSignal={lsp.diagnosticsForUri(lspUri)}
            lspCapabilities={lsp.capabilitiesFor(lspUri)}
        />
    )
}
```

`CodeMirrorHost` is the only piece that knows how to translate between signal-land and CodeMirror's transactional reactive system. Components above and services below never touch CodeMirror's internals.

---

## Canonical example: `TextModelService`

This service is the template. New services should follow the same skeleton.

### Document id convention

- File with a known path → `docId = path`
- Untitled file → `docId = 'unsaved:' + tempId` (tempId always allocated by `PendingFilesService`)

### Public types

```ts
export type DocumentId = string

export type SaveResult =
    | { ok: true; noop?: boolean }
    | { ok: false; error: SaveError }

export type SaveError =
    | { kind: 'requires-path' }
    | { kind: 'network'; cause: unknown }
    | { kind: 'orphaned' }

export interface TextModel {
    readonly id: DocumentId
    readonly tempId: string | null
    readonly path: ReadonlySignal<string | null>
    readonly content: ReadonlySignal<string>
    readonly original: ReadonlySignal<string>
    readonly dirty: ReadonlySignal<boolean>     // computed
    readonly orphaned: ReadonlySignal<boolean>
    setContent(content: string): void
    discard(): void
}

export type TextModelServiceEvent =
    | { kind: 'modelRekeyed'; oldId: DocumentId; newId: DocumentId }
    | { kind: 'saveSucceeded'; docId: DocumentId; path: string }
    | { kind: 'saveFailed'; docId: DocumentId; error: SaveError }
    | { kind: 'conflictAppeared'; path: string }
```

### Service dependencies

```ts
export interface TextModelServiceDeps {
    projectId: string
    client: HCClient
    fileTree: FileTreeService
    pendingFiles: PendingFilesService
    actions: ActionRegistry
    context: ContextService
    activeEditor: ActiveEditorRegistry
}
```

No React, no Storage, no Platform.

### Service public API

```ts
export class TextModelService {
    readonly dirtyModels: ReadonlySignal<readonly TextModel[]>
    readonly anyDirty: ReadonlySignal<boolean>
    readonly conflicts: ReadonlySignal<ReadonlySet<string>>
    readonly events: Event<TextModelServiceEvent>

    constructor(deps: TextModelServiceDeps)

    getOrOpen(docId: DocumentId, initialContent: string): TextModel
    get(docId: DocumentId): TextModel | undefined
    close(docId: DocumentId, opts?: { force?: boolean }): void

    save(docId: DocumentId, opts?: { path?: string }): Promise<SaveResult>
    saveAll(): Promise<ReadonlyMap<DocumentId, SaveResult>>

    // Called by ServerEventsConnection on SSE updates
    handleExternalChange(path: string, newContent: string): void
    handleExternalDelete(path: string): void
    handleRename(oldPath: string, newPath: string): void

    // Conflict resolution
    keepLocal(path: string): void
    acceptExternal(path: string): void

    dispose(): void
}
```

### Save flow

Single-flight per `docId`. Captures snapshot before network. Commits to the snapshot (not current content) so concurrent edits during the round-trip remain correctly dirty.

```ts
async save(docId: DocumentId, opts?: { path?: string }): Promise<SaveResult> {
    const model = this.modelsInternal.get(docId)
    if (!model) return { ok: true, noop: true }
    if (!model.dirty.peek()) return { ok: true, noop: true }

    const path = opts?.path ?? model.path.peek()
    if (!path) return { ok: false, error: { kind: 'requires-path' } }
    if (model.orphaned.peek()) return { ok: false, error: { kind: 'orphaned' } }

    const inflight = this.inflight.get(docId)
    if (inflight) {
        await inflight.catch(() => {})
        if (!model.dirty.peek()) return { ok: true, noop: true }
    }

    const snapshot = model.content.peek()
    const promise = this._doSave(model, path, snapshot)
    this.inflight.set(docId, promise)
    try {
        return await promise
    } finally {
        if (this.inflight.get(docId) === promise) this.inflight.delete(docId)
    }
}
```

### Autosave

A single `effect` per model. Auto-tracks `content`, `dirty`, `path`, `orphaned` by reading them. Re-runs on any change, reschedules the trailing-edge timer.

```ts
private _setupAutosaveFor(model: TextModelInternal): () => void {
    return effect(() => {
        const _ = model.content.value
        if (!model.dirty.value) return
        if (!model.path.value) return
        if (model.orphaned.value) return

        const existing = this.autosaveTimers.get(model.id)
        if (existing) clearTimeout(existing)

        const timer = setTimeout(() => {
            this.autosaveTimers.delete(model.id)
            void this.save(model.id)
        }, AUTOSAVE_DELAY_MS)
        this.autosaveTimers.set(model.id, timer)

        return () => {
            const t = this.autosaveTimers.get(model.id)
            if (t === timer) {
                clearTimeout(t)
                this.autosaveTimers.delete(model.id)
            }
        }
    })
}
```

### Action registrations

```ts
private _registerActions(): void {
    const reg = this.deps.actions
    this._actionDisposers.push(reg.register({
        id: 'editor.save',
        title: 'Save',
        keybinding: '$mod+s',
        when: 'editorFocused && editorDirty',
        run: async () => {
            const docId = this.deps.activeEditor.activeDocId.peek()
            if (!docId) return
            const result = await this.save(docId)
            if (!result.ok && result.error.kind === 'requires-path') {
                await this.deps.actions.run('editor.savePrompt', { docId })
            }
        },
    }))

    this._actionDisposers.push(reg.register({
        id: 'editor.saveAll',
        title: 'Save All',
        keybinding: '$mod+alt+s',
        when: 'anyDirty',
        run: () => this.saveAll(),
    }))

    this._actionDisposers.push(reg.register({
        id: 'editor.revert',
        title: 'Revert File',
        when: 'editorFocused && editorDirty',
        run: () => {
            const docId = this.deps.activeEditor.activeDocId.peek()
            if (!docId) return
            this.get(docId)?.discard()
        },
    }))
}
```

`editor.savePrompt` is registered separately by a `DialogService`. The same prompt is reachable from anywhere — menu, command palette, this fallback path.

### Context key derivations

```ts
private _registerContextKeys(): void {
    this._contextDisposers.push(
        this.deps.context.derive('editorDirty', () => {
            const docId = this.deps.activeEditor.activeDocId.value
            if (!docId) return false
            return this.modelsInternal.get(docId)?.dirty.value ?? false
        })
    )
    this._contextDisposers.push(
        this.deps.context.derive('anyDirty', () => this.anyDirty.value)
    )
}
```

### Window close guard

The browser `beforeunload` listener is set up by the React shell, not by the service:

```tsx
// web/src/main.tsx (or similar)
useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
        const project = app.currentProject
        if (!project) return
        if (project.textModels.anyDirty.peek()) {
            e.preventDefault()
            e.returnValue = ''   // legacy Chrome
        }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
}, [app])
```

Desktop adds a Wails-specific equivalent via the window-close event.

### Disposal

```ts
dispose(): void {
    for (const t of this.autosaveTimers.values()) clearTimeout(t)
    this.autosaveTimers.clear()
    for (const d of this._actionDisposers) d()
    for (const d of this._contextDisposers) d()
    for (const d of this._effectDisposers) d()
    this.modelsInternal.clear()
    this._events.dispose()
}
```

### Test plan

Tests live next to the source as `*.test.ts`, run via `bun:test`, never mount React.

```ts
describe('TextModelService — basic lifecycle', () => { ... })
describe('TextModelService — content + dirty signals', () => { ... })
describe('TextModelService — save', () => {
    test('save with no dirty buffer is a noop')
    test('save calls API with current content, commits to that snapshot')
    test('save on untitled with no path returns requires-path error')
    test('concurrent save() calls coalesce into one network request')
    test('typing during save leaves model dirty against the saved snapshot')
    test('first save of untitled promotes it: docId, tempId cleanup')
})
describe('TextModelService — autosave', () => { ... })
describe('TextModelService — external changes', () => { ... })
describe('TextModelService — actions', () => { ... })
describe('TextModelService — context keys', () => { ... })
describe('TextModelService — disposal', () => { ... })
```

---

## Anti-patterns

Patterns that look right but aren't.

### ❌ Importing React from a service

```ts
// common/src/model/text-models/TextModelService.ts
import { useEffect } from 'react'   // ✗ no
```

Services are React-free. If you need a hook, it goes in `react.ts`. If you need to do something on a lifecycle event, the service has `constructor` and `dispose()`.

### ❌ Using `.value` in an imperative method

```ts
async save(docId: DocumentId): Promise<SaveResult> {
    const model = this.models.get(docId)
    if (!model?.dirty.value) return { ok: true }   // ✗ subscribes
    // ...
}
```

Use `.peek()` in methods. `.value` is only for `computed` and `effect`.

### ❌ Storing model state in React component state

```tsx
function FileEditor({ path }: { path: string }) {
    const [content, setContent] = useState('')   // ✗ duplicate state
    // ...
}
```

State lives on the service. React subscribes via signal hooks.

### ❌ Calling service methods directly for user-initiated mutations

```tsx
<Button onClick={() => textModels.save(activeDocId)}>Save</Button>   // ✗ bypasses actions
```

```tsx
<Button onClick={() => actions.run('editor.save')}>Save</Button>     // ✓
```

Going through actions means the same code path serves the button, the menu, the keybinding, the command palette, and tests. Direct method calls are fine in services and in `useEffect` bootstrap, not in user-initiated paths.

### ❌ Cross-service references via shared singleton state

```ts
// somewhere/globals.ts
export let lspService: LspService | null = null   // ✗ no
```

Services receive deps via constructor. The `Project` container wires them. No globals, no service locator.

### ❌ Mutating a public signal from outside its service

```ts
const dirty = textModels.get(id)?.dirty
if (dirty) (dirty as Signal<boolean>).value = false   // ✗ no
```

Public signals are `ReadonlySignal<T>`. Writes go through service methods.

### ❌ Building UI logic in a service

```ts
class TextModelService {
    showSaveDialog() {                    // ✗ services don't render UI
        // ...
    }
}
```

UI lives in React. Services trigger UI by dispatching actions (`actions.run('editor.savePrompt')`) or by exposing signals the UI subscribes to. Never the other way.

### ❌ Forgetting `dispose()`

Every service needs `dispose()`. Every action registration returns a disposer that must be saved and called. Every effect returns a disposer that must be saved and called. Failure to dispose causes worker leaks, ghost listeners, and HMR weirdness.

### ❌ Direct CodeMirror manipulation outside the host component

```tsx
function SomeRandomComponent() {
    const view = someGlobalActiveEditorView
    view.dispatch(...)   // ✗ no — go through ActiveEditorRegistry or actions
}
```

CodeMirror state is owned by the host component. Other components address "the active editor" via `ActiveEditorRegistry` (which exposes view-level signals like cursor position) or via actions like `editor.scrollToLine`.

---

## Testing conventions

- **Tests use `bun:test`.** No Vitest, no Jest. No RTL.
- **Co-located.** `XService.test.ts` lives next to `XService.ts`.
- **Test the service directly.** Construct it with fake deps, call methods, assert on signal values via `.peek()`.
- **Fake siblings.** Use lightweight fake services (typed as the dep interfaces) rather than real ones. If two services have intricate interactions, a small integration test that constructs both with a fake `HCClient` is fine.
- **No DOM, no React.** Model tests run in Node-flavored Bun. React component tests don't exist for the model layer; if you find yourself wanting one, the test belongs at the service level.
- **One behavior per test.** "Save coalesces concurrent calls" is one test. Don't bundle.

### Fake `HCClient` shape

```ts
function makeFakeClient(opts?: { updateDelay?: number; failNextUpdate?: boolean }) {
    const calls = { update: [] as Array<{ path: string; body: string }> }
    const client = {
        v1: {
            map: {
                files: {
                    update: async (projectId: string, path: string, body: string) => {
                        calls.update.push({ path, body })
                        if (opts?.updateDelay) await sleep(opts.updateDelay)
                        if (opts?.failNextUpdate) {
                            opts.failNextUpdate = false
                            throw new Error('boom')
                        }
                    },
                    // ...
                },
            },
        },
    } as unknown as HCClient
    return { client, calls }
}
```

---

## Migration plan

The refactor is big but breaks into independently shippable slices. Order matters — earlier phases unblock later ones.

### Phase 1: Foundations

1. **Conventions** — author this doc (done by reading this) and a `common/src/model/README.md` pointer.
2. **Primitives** — `Emitter`, `useSignal` adapter, project-context provider scaffolding. Re-export `@preact/signals-core` from `common/src/model/foundation/signal.ts` so all internal usage routes through one path.
3. **Lint substrate** — ban `react` imports from `common/src/model/**` (file-based or via an eslint custom rule). Add a check that bans `.value` in service files outside `computed`/`effect` (heuristic; not perfect).

### Phase 2: Auth (smallest surface, learns the pattern)

4. Extract `AuthService` from `AuthProvider` — pure class with state machine in signals. The new `<AuthProvider>` is a 30-line React bridge.
5. Migrate auth tests. The redeem / tokens / dpop tests already exercise plain TS — they survive untouched.

### Phase 3: Drop TanStack Query

6. Convert endpoints from `useFoo` hooks to plain `foo(client, args)` functions. Strip every `use*` hook from `api/src/endpoints/`.
7. Remove `@tanstack/react-query` and the dev devtools toggle. Remove `<HCClientProvider>` — the model owns the client.

### Phase 4: Project container + easy services

8. Define `Project` container, wire empty service instances.
9. Lift `WorkspaceLayoutService` (already a Zustand store) into the model layer. Reshape internals as signals.
10. Lift `DocumentsModel` → `TextModelService` per this spec. Move autosave from the React effect into the service.
11. Lift `PendingFilesService` and `ActionRegistry` (already a class).
12. Build `ContextService` from scratch with `derive` + `set`.

### Phase 5: Async subsystems

13. `LspService` (worker lifecycle, diagnostics signals, capability dispatch).
14. `EngineApiService`.
15. `ServerEventsConnection` (SSE), wired into siblings via injected callbacks.
16. `SearchService` with sources registered by `FileTreeService`, `LspService`, `ActionRegistry`, `EngineApiService`.

### Phase 6: React collapse

17. Rewrite `ProjectWorkspace` to a 3-deep provider tree: `<ProjectErrorBoundary>` → `<TooltipProvider>` → `<ProjectProvider>` → workspace.
18. Update page shells (web `pages/index.tsx`, desktop `pages/project/[projectId].tsx`) to construct the `Project` model in a `useEffect`, dispose on cleanup.
19. Move all current action handlers from components into the relevant services. Components only call `actions.run(...)`.

### Phase 7: Cleanup

20. Delete dead React context files, old hooks, the unused providers, `<HCClientProvider>`, `react-query` dev devtools, `useV1*` endpoint hooks.
21. Update CLAUDE.md sections that describe the old architecture.

Each phase is independently testable; you can pause and ship between any two.

---

## Risk register

- **HMR with disposable models.** When the shell hot-reloads, the model is re-created, terminating the LSP worker and reopening SSE. Dispose must be idempotent.
- **The action-context bridge** (focus state pushed from React into `ContextService`) is the only reverse flow. Don't let other React-pushes-into-model patterns creep in.
- **Optimistic-update bugs.** Without TanStack Query's cache layer, mutations must patch model state explicitly after the network confirms, with rollback on error.
- **Workers and SSE leaks.** Wrong disposal order is the bug that doesn't surface until you've opened and closed projects ten times in dev.
- **`peek()` vs `.value` mistakes** silently capture dependencies. Get the lint rule in place early.

---

## See also

- [`docs/model-architecture-textmodelservice.md`](./model-architecture-textmodelservice.md) — to be written. The full implementation-level spec extracted from this doc for handoff to whoever implements that service.
- [`CLAUDE.md`](../CLAUDE.md) — top-level project guidance. References this doc.
