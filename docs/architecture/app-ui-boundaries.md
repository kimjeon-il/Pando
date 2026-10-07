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

Application implementations now live in the existing app-* owners and are wired
by app-composition.js and capability ports. app.js is only the versioned loader.
The remaining workflow owners include app-country-commits, app-territorial-drafts,
app-project-restore and app-domain-assembly; they are not alternative model stores.

SelectionDomain supplies the current primary selection as a read-only session
query. Selection change callbacks receive the previous selection directly, so the
UI can cancel an old editing target without a second mutable selection field.
History candidate preparation belongs to project-state; app-project-snapshots
performs the existing publication and history wiring. Browser storage I/O belongs
to browser-project-storage, while persistence-service retains queue/recovery policy.

See [platform-boundaries.md](platform-boundaries.md) for Web/App owners and evidence.
Focused behavior coverage remains in the existing UI/composition/domain tests.
