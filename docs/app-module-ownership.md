# Application module ownership

`assets/js/app.js` is the revisioned entry point only. It loads
`app-composition.js`, composes the application, and starts the existing
`application-lifecycle.js` lifecycle. The runtime-boundary check limits the entry
to 400 nonempty lines and rejects feature implementations there.

## Composition and lifetime

1. Load the existing runtime dependencies and owner factories with the same asset revision.
2. Construct owners without DOM side effects or event registration.
3. Connect each owner exactly once through the named `app-connect-*` modules.
4. Run initialization stages in the original application statement order.
5. Start the existing lifecycle, which initializes the domains before binding UI events.

The connections are explicit named getters and, only where existing code replaces
a binding, setters. They do not copy state, create a registry, or perform render
work. For example, replacing the canonical store or a controller is visible to
its consumers without reconstructing their ports. The project/session state
remains owned by `app-project-session.js`; selection remains in SelectionDomain.

Initialization stages are separate from construction because the existing code
contains forward callbacks between owners. Do not move event registration into
factory construction, eagerly read another owner's mutable values, or initialize
a stage twice. Stage names identify the first binding initialized at that point,
not an independently repeatable reset API.

## Responsibility map

All names below are under `assets/js/modules/` and have an `app-` prefix.

| Responsibility | Owners |
| --- | --- |
| Runtime/module loading | `runtime-dependencies` (shared lazy promises, retries, versioned URLs) |
| Startup and disposal | `composition`, `domain-assembly`, `lifecycle-assembly`, `progressive-startup` |
| Environment and project session | `environment`, `builtin-session`, `project-session` |
| UI surfaces and bindings | `workspace-surfaces`, `navigation-bindings`, `tool-bindings`, `file-bindings`, `global-input-bindings`, `editor-bindings` |
| UI feedback | `readiness-notifications`, `task-presentation`, `territory-component-ui` |
| Object operations | `object-commands`, `generic-commands`, `object-deletion`, `object-metadata`, `territorial-conversion` |
| Selection/property presentation | `property-selection`, `object-presentation`, `layer-list`, `color-picker` |
| Project/history and IO | `project-snapshots`, `history-assembly`, `project-restore`, `gis-assembly`, `library-assembly` |
| Editing workflows | `country-modes`, `country-commits`, `territorial-drafts`, `river-candidates`, `geometry-preview` |
| Spatial/geometry preparation | `country-index`, `spatial-index`, `country-validation`, `land-relations`, `cut-geometry`, `territory-components` |
| Projection and input | `map-projection`, `camera-navigation`, `map-host`, `pointer-targets`, `object-picking` |
| Render resources | `service-assembly`, `gpu-scene`, `interaction-packets`, `country-labels`, `physical-resources`, `render-quality`, `map-audit` |
| Map settings | `map-settings`, `hydro-settings` |

The connection files contain only wiring: `foundation`, `spatial-data`,
`map-resources`, `map-interaction`, `object-editing`, `project-io`, and
`lifecycle-ui`. Actual algorithms belong to the owners, or to the pre-existing
domain/service modules they call. In particular, `domain-assembly` configures
the existing domains; it does not replace their ownership contracts.

## Contracts retained

- Modal, GIS and historical runtime loads remain demand-driven and retryable.
- Existing project, selection, transaction, generation and Undo contracts remain authoritative.
- Frame snapshots, GPU/SVG coverage, canonical meshes and Worker lifetimes are unchanged.
- No additional render/resize loop, eager focus, geometry union or per-frame state copy is introduced.
- Existing debug facades and the pagehide/back-forward-cache disposal policy remain in the lifecycle assembly.
- Relative lazy-load URLs are still resolved against the original application asset base.

## Focused checks

`tests/unit/application-composition.test.mjs` checks the entry boundary,
side-effect-free owner construction, complete named connections, single connect,
live replacement ports and canonical-store replacement. The river request tests
now instantiate the actual river-candidate owner instead of evaluating a sliced
copy of `app.js`.

Source contracts use `scripts/lib/application-source.mjs` to select actual owners.
The application-wide legacy Python contracts use `tests/application_source.py`.
Only dependency-port spelling is normalized; algorithm assertions are retained.
Function-specific checks use parsed function ranges rather than assuming the next
function is still in the same file. The runtime-boundary checker covers all
implementation owners and includes revisioned dynamic imports in its cycle graph.
