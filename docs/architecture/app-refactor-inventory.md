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
