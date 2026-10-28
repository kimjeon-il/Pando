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

## Shared product and platform composition

`map-owner-ports.js` owns the allowed and required dependency contracts for the
shared map owners. Both products connect through this boundary. Ports remain
live, including accessors and sources installed later in startup. Editor-only
commands remain in the editor composition; they are not empty Viewer services.

`createMapReadPorts` owns the shared owner-to-owner member mappings. Both products
merge these live descriptors with their host services and editor capabilities;
they do not snapshot late-installed sources. `initializeMapReadOwners` groups
query, spatial, label, anchor and projection initialization without owning product
startup, document admission or native lifecycle policy.

`createMapRenderingResources` composes the shared display resources from the
existing ports, canonical selection session and live layer references. Resources
refresh once per render frame. Editor preview, editing interaction and editing
metrics are explicit editor extensions; renderer dependency keys and caches stay
with their existing owners.

`createMapInputPresentation` reads current map state from the shared ports and
accepts explicit editor hooks. Both products use the same operation error
contract: error, user message, code and duration. Select-mode touch releases
select directly and suppress a later synthetic click through the existing input
controller. Map settings own accepted
layer-visibility source preparation through the existing hydro/place loaders.

`runtime-context.js` validates the immutable generated build receipt and owns
versioned asset URL construction. Composition passes that receipt to builtin
and physical resource owners. Module-relative imports use their versioned
module URL. The immutable Worker resolver remains the asset-manifest boundary.

`file-controller.js` owns file workflow and ProjectDomain commands. An explicit
browser or native file-access port owns pickers, input events, paths/URIs and
bytes. `prepareProjectSave()` runs before encoding and returns a `write`/`abort`
destination. The browser picker opens during preparation to retain user
activation. Native transport retains its existing `finish_document_write`
dialog timing and chunk protocol. Persistence receives its resolved preview Worker URL; it does not
read platform globals or resolve deployment paths itself.

Library composition injects the existing loader contract and a separate optional
editing repository. Only the native entry interprets native capability globals.
Remote admission checks, repository revisions and source integrity remain in
their established owners.

ApplicationLifecycle owns the single startup Promise, awaits ready hooks and
suppresses late publication after disposal. Product startup/restore work is
injected; platform shells retain IPC, profile and network security boundaries.

Focused behavior coverage remains in the existing UI/composition/domain tests.
