# Editor

The web and desktop editor for server-side luau scripting.

## Project Structure

A [Bun](https://bun.sh)-managed monorepo. Most of the app lives in `common/`; `web/` and
`desktop/` are thin platform-specific shells.

- `common/` (`@hollowcube/common`): platform-agnostic app code
    - `workspace/`: generic split/dock layout engine (Zustand + dnd-kit)
    - `project/`: the application shell that wires tools and editors onto the workspace
    - `editor/`: CodeMirror 6 code editor and extensions
    - `platform/`: web/desktop platform abstraction
- `design-system/` (`@hollowcube/design-system`): UI primitives (base-ui + Tailwind v4)
- `api/` (`@hollowcube/api`): partial `api-server` public api client
- `web/` (`@hollowcube/web`): browser SPA shell (Vite + React 19)
- `desktop/` (`@hollowcube/desktop`): Wails 3 desktop shell (`frontend/` React app + Go host)

## Getting Started

```sh
bun install
bun run dev:web      # browser app
bun run dev:desktop  # Wails desktop app (requires the wails3 CLI + Go)
```

`bun run typecheck`, `bun run test`, `bun run lint`, and `bun run format` all run across
every workspace.

## AI Disclaimer

The editor was built out with Claude Code. Expect lots of rough edges for now.

## Contributing

Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) before opening a pull request.

All contributors must sign our
[Contributor License Agreement](https://hollowcube.net/legal/individual-contributor-license-agreement).
You'll be prompted automatically on your first PR.

## Community

We have a dedicated `#general-dev` channel in our [Discord](https://discord.hollowcube.net) for related questions.

## License

The code in this repository is licensed under the [MIT License](LICENSE).

<details>
<summary><strong>Credits</strong></summary>

<br>

This editor is built on the work of others:

- **[Bun](https://bun.sh)**: runtime, package manager, and test runner for the monorepo
- **[CodeMirror 6](https://codemirror.net)**: the editor engine the code editor is built on
- **[luau-lsp](https://github.com/JohnnyMorganz/luau-lsp)**: Luau language server powering completions and diagnostics
- **[Lucide](https://lucide.dev)**: icon set (`lucide-react`)
- **[Catppuccin](https://catppuccin.com)**: color palette and [icon theme](https://github.com/catppuccin/vscode-icons)
- **[JetBrains Fleet](https://www.jetbrains.com/fleet/)**: design inspiration for many UI elements

</details>
