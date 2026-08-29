# PandoLab runtime refactor inventory

This inventory fixes the Phase 06 extraction boundaries before code is moved. It describes the current `assets/js/app.js` responsibilities; it is not a new runtime contract.

| Current responsibility | Approximate current range | Coupling / strongly connected group | Target boundary |
| --- | ---: | --- | --- |
| Runtime imports, compatibility checks, startup | 1-470, 14398-end | browser globals, readiness, renderer | `app.js` composition root |
| Responsive surfaces and menus | 468-990 | DOM, history, surface controller | UI controllers |
| Session scheduler and state assembly | 991-1225 | all later groups read the state | scoped store and runtime wiring |
| Selection, batch actions, object menu | 1226-1758 | document, presentation, editor DOM | selection/editor controllers plus commands |
| Map input, snapping, navigation | 1814-2307 | projection, draft, renderer | existing interaction controllers plus view helpers |
| Country indexing and geometry transactions | 2336-4097 | document geometry, workers, history, renderer | territorial service and render coordinator |
| Domain normalization and layer model | 4194-4714 | drawing, hydro, territorial, distribution, presentation | domain services and selectors |
| Layer tree and map rendering | 4722-6766 | DOM/SVG, presentation, GPU renderer | layer controller and render coordinator |
| Draft and tool workflows | 6767-9012 | interaction, geometry, document commands, HUD | tool application service and HUD controller |
| Editor panels and domain CRUD | 9013-11008 | DOM forms, document commands, presentation | editor controller and domain services |
| History and projection | 11009-11384 | document snapshots, view session, presentation | history service and view commands |
| Project persistence | 11385-11727 | project/presentation serialization, IndexedDB, localStorage, view record | persistence service |
| Confirmations and destructive commands | 11728-11944 | modal DOM, document commands | modal controller and domain commands |
| GIS import/export | 11945-12337, 12687-13165 | workers, staging, schema validation, domain materialization | import service and GIS controller |
| Historical library | 12338-12686 | library model, project instantiation, modal DOM | historical library service/controller |
| Deletion and focus/navigation | 13166-13574 | domain commands, presentation cleanup, view | domain services and view commands |
| Event binding | 13575-14397 | all DOM surfaces and command callbacks | focused UI controllers |

## Extraction order and dependency rule

1. Move storage and autosave behind a DOM-free persistence service.
2. Wrap terrain and hydro loading behind facades without rewriting workers or retry behavior.
3. Move document mutation rules into territorial, distribution, and drawing services; UI retains only value collection and rendering.
4. Centralize render ordering and dirty/revision requests; renderer callbacks never write the document.
5. Move modal, layer, editor, HUD, library, and GIS DOM behavior into controllers with narrow `selectors` and `commands` inputs.
6. Keep `app.js` as the composition root and remove wrappers only after all call sites use the new boundary.

The following dependencies are intentionally one-way: UI controller → application service → scoped state command → pure model/geometry utility. Persistence and renderer orchestration receive selectors, never the mutable project object as an ambient global.

## Phase 06 implemented boundaries

The inventory above records the pre-extraction responsibility map. Phase 06 keeps `app.js` as the browser composition root, but the following behavior now lives behind explicit, independently tested boundaries.

| Boundary | Owns | Does not own |
| --- | --- | --- |
| `project-serializer.js` | current project and autosave materialization | browser storage, UI |
| `persistence-service.js` | IndexedDB/local fallback, autosave queues, view record | document mutation, DOM |
| `physical-layer-service.js` | terrain and hydro manifest/retry lifecycle | renderer internals, project objects |
| `territorial-service.js` | territorial metadata and geometry transaction commands | form values, DOM |
| `distribution-service.js` | distribution layer/entry CRUD and validation | drawing objects, UI rendering |
| `drawing-service.js` | custom drawing CRUD and semantics | hydro objects, UI rendering |
| `history-service.js` | bounded document undo/redo snapshots and metadata | draft-local history, project serialization |
| `import-service.js` | GIS staging result routing, strict country validation, merge planning | wizard DOM, status presentation |
| `historical-library-service.js` | load/query/descendant expansion/instance descriptors | modal DOM, canonical project mutation |
| `map-render-coordinator.js` | full/view render order and render revision scheduling | canonical document mutation |
| `map-edit-worker-client.js` | rebase/patch/execute protocol, revision rejection, cancellation | applying results to the document |
| UI controllers | tooltip, confirm modal, layer panel, historical-library modal lifecycle | raw workers, geometry/domain mutation rules |

The composition root wires selectors and commands into these boundaries, owns startup and fatal error handling, and retains the existing high-coupling interaction/editor workflows that were not safe to rewrite in a behavior-neutral packet. Between the Phase 05 checkpoint (`3eee576`) and the completed Phase 06 extraction, `app.js` dropped from 14,735 to about 13,940 lines while moving 1,400 existing lines out of the file; dependency wiring added roughly 600 explicit lines in their place.

## Enforced dependency checks

`pnpm check:architecture` now fails when:

- an `assets/js/modules` static-import cycle is introduced;
- a domain/application service starts querying the DOM;
- IndexedDB or localStorage writes bypass `persistence-service.js`;
- `app.js` reintroduces the raw map-edit Worker execute protocol.

The remaining direct Worker calls in `app.js` are intentionally limited to the country-label anchor and map-audit application facades. GIS country validation is confined to `import-service.js`; political mesh and hydro Worker traffic remains inside the renderer. The debug-only `localStorage.getItem('atlaswright.debug-map')` read is a session preference and is not project persistence.
