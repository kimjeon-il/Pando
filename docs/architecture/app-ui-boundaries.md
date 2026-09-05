# Application UI and lifecycle boundaries

`app.js` supplies explicit queries and commands to these production modules:

| Module | Ownership |
| --- | --- |
| `property-editor-bindings.js` | Property field/action listeners and their teardown; selection is queried, never stored here. |
| `project-ui-bridge.js` | Draft-vs-project Undo/Redo routing, new-project confirmation and save/history presentation. |
| `map-input-presentation.js` | Map movement presentation, SVG pointer/hover routing and input-controller teardown for both flat and globe views. |
| `gis-workflow-controller.js` | Lazy GIS service/wizard composition, current-project wizard options, identity/impact planning and validator lifetime. |
| `map-debug-controller.js` | Debug panel and existing render/view diagnostic facades; dynamic resources are read when queried. |
| `application-lifecycle.js` | One startup Promise, ordered composition, readiness/error publication and BFCache-aware disposal. |

Composition order is UI bridges, domains, map-input bridge, then startup.
The input bridge receives initialized domains; callbacks from UI bridges may
query domains later, but must not eagerly capture a null domain during composition.

GIS runtime loading stays lazy and coalesces concurrent callers. A rejected
initialization is retryable, while disposal prevents late initialization.
Import execution continues through GIS planning and the existing EditingDomain
commit path. These UI modules do not change canonical geometry or history formats.

Detailed geometry transactions, color-picker implementation, canonical startup
application and domain resource adapters still live in `app.js`. This extraction
does not claim that the application has become a complete thin bootstrap.

`check-runtime-boundaries.mjs` rejects reintroduced extracted function declarations
and limits non-empty app lines to 14,100. Focused behavior coverage lives in
`tests/unit/app-ui-boundaries.test.mjs`.
