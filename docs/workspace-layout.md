# Source and output layout

The Web Viewer is the only shipping product. [Module ownership](app-module-ownership.md) defines the product domains; [branch policy](branch-policy.md) defines permanent checkouts. All maintained branches use this layout.

| Location | Responsibility |
| --- | --- |
| `src/app/` | Viewer entry, HTML and application composition |
| `src/ui/` | UI controllers, CSS and HTML fragments |
| `src/data/`, `document/`, `map/`, `geometry/`, `rendering/`, `runtime/` | Product behavior owned by domain; C++ implementations live in each domain's `native/` |
| `assets/` | Static release inputs, fonts, brand icons and verified WASM; `assets/data` is a library mount |
| `tools/build/native/` | Product native build orchestration and compiler-cache CMake integration; compilation runs in CI |
| `tools/cpp/` | GIS command-line generator implementations, their native dependencies and tests; these are tools, not Viewer source |
| `tools/gis/`, `tools/data/`, `tools/checks/` | GIS adapters, library/storage operations and scoped audits |
| `scripts/` | Development, frontend generation, CI selection and execution; `scripts/contracts/` owns executable check contracts |
| `tests/` | Unit/browser checks, helpers and fixed fixtures |
| `config/` | Runtime data pin, source roots, artifact graph and tool versions |
| `docs/policies/` | Policy navigation and domain rules, including machine-readable execution/publication policy |
| `docs/architecture/`, `docs/development/` | Maintained architecture and developer instructions |
| `docs/superpowers/`, `docs/validation/` | Dated specifications and historical verification; not current commands or duplicate runtime policy |
| `validation-results/` | Tracked historical measurements consumed by named replay/evaluation workflows; not general build output |
| `projects/`, `reports/` | Pinned project declarations and the central report-originals mount; data remains library-owned |

## Source paths and public URLs

`scripts/lib/frontend-layout.mjs` maps source paths to public URLs. Moving a source between domains does not rename its published module URL. HTML fragments, CSS, static/dynamic imports and Worker dependencies use the same map. Pages includes only the Viewer dependency closure.

Use `pnpm.cmd deps:prepare`, `pnpm.cmd dev:web` and `pnpm.cmd build:web`. The root package manifest is the executable command inventory. Retired editor/native application commands and source folders are absent.

## Local outputs and cleanup

`tools/data/worktree-storage.mjs` owns shared immutable frontend outputs and dependencies. `.library-data/frontend-artifacts.json` holds checkout references; runtime leases protect active data. `node_modules` keeps checkout-specific links to the shared pnpm store. Editable sources remain independent.

`.library-data/`, `build-native/`, `test-results/` and project-created verification profiles are working outputs, not source locations. Keep only current consumers and active incremental outputs. Source watchers must exclude these paths and dependency stores. JS/CSS reload must not prepare all data or invoke native compilation.

Before moving or removing outputs, check pins, mounts, processes, leases and journals. Never traverse data/dependency junctions during source cleanup. Sources, unique evidence and unfinished work remain protected by [AGENTS.md](../AGENTS.md); local compiler restrictions and cleanup follow that policy and [worktree storage](worktree-storage.md).

The previous mixed Web/App layout text is preserved as original bytes in the library's private evidence, `retired-workspace-layout/workspace-layout-before-20261113.md`. Historical specifications retain their original paths; they do not define the current layout.
