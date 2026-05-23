# Model layer

This directory holds the editor's **model layer** — plain TypeScript services that own state and behavior. The model layer is **React-free** by design. The full architecture is documented in [`docs/model-architecture.md`](../../../docs/model-architecture.md); read it before writing or modifying anything here.

## The five rules

1. **Services are plain TypeScript classes.** No React imports. Constructor-injected dependencies. `dispose()` on every service.
2. **State lives in `@preact/signals-core` signals.** Private writable signals, public `ReadonlySignal<T>` views. Cross-service derived state is `computed(() => ...)`.
3. **`ActionRegistry` is the universal command bus.** User-initiated mutations are actions with an id, optional keybinding, optional when-clause, and a `run` handler registered by the service that owns the data.
4. **`ContextService` holds reactive context keys.** When-clauses like `editorFocused && editorDirty` are evaluated against it. Most keys are derived via `context.derive(key, fn)`; a few are pushed in from React via `context.set(key, value)`.
5. **`peek()` in methods, `.value` in `computed`/`effect`.** Reading `.value` in an imperative method silently captures reactive dependencies on whatever tracking context happens to be on the stack — almost always a bug. Use `.peek()` to read without subscribing.

## Layout

Each service lives in its own subdirectory:

```
common/src/model/
    foundation/                — shared primitives (Emitter, useSignal, etc.)
    <kebab-name>/
        <ServiceName>.ts       — the service class
        react.ts               — React hooks (the only file here that imports React)
        <ServiceName>.test.ts  — bun:test, no React, no DOM
```

## Canonical reference

`TextModelService` is the canonical template. Until it lands as code, the [full spec is in the architecture doc](../../../docs/model-architecture.md#canonical-example-textmodelservice) — typed deps, signals as state, methods as mutations, actions registered at construction, context keys derived, `Emitter` for discrete events, disposal in reverse construction order.

## Adding a new service

Use the [`add-service` skill](../../../.claude/skills/add-service.md):

```
/add-service
```

It scaffolds the three files, registers the service in the parent container (`EditorApp` for app-scoped, `Project` for project-scoped), and runs `bun run lint` + `bun run typecheck` to verify the output. If you prefer to do it by hand, follow the same template structure embedded in that skill.

## Lint hygiene

Two automated checks enforce conventions:

- **`no-restricted-imports`** (oxlint override, scoped to `common/src/model/**`): bans `react`, `react-dom`, and `@base-ui/react` imports. Exception: `react.ts` and `*.test.ts` files in this directory are excluded.
- **`lint:signals`** (custom script at [`scripts/lint-signals.ts`](../../../scripts/lint-signals.ts)): flags `.value` reads outside `computed`/`effect`. Lexical check via the TypeScript AST. Assignments (`signal.value = x`) are allowed because they're writes, not reads.

Both run automatically as part of `bun run lint`. The signals check can be run independently with `bun run lint:signals`.

## Anti-patterns

Quick reference; full list in the [architecture doc](../../../docs/model-architecture.md#anti-patterns):

- ❌ Importing `react` from a service.
- ❌ Using `.value` in an imperative method.
- ❌ Storing model state in React component `useState`.
- ❌ Calling service methods directly from `onClick` for user actions (use `actions.run('action.id')`).
- ❌ Mutating a public signal from outside its owning service.
- ❌ Skipping `dispose()`.
