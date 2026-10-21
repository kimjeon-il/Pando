# Web viewer / native editor execution ledger

Approved specification: user supplied implementation plan in this chat, 2026-10-18.

## Constraints

- Keep shared C++ document, renderer and current GeoPackage format canonical.
- Viewer has fixed read-only capabilities; native editor retains current editing.
- Phone Android landscape both directions; tablets/foldables/multiwindow adaptive.
- Reuse work/ui; preserve preexisting dirty work; no main integration or deployment.
- Reports belong in reports/; this file is the implementation ledger, not a validation report.
- Use the existing UI and current object categories. Do not add a visible viewer/read-only title or badge.

## Tasks

- [x] Shared execution and readonly document boundary.
- [x] Viewer UI, canonical map rendering and atomic project opening.
- [x] Explicit editor HTML and product-specific distribution manifests.
- [x] Phone landscape panels and Android orientation policy.
- [x] Focused tests, workflow verification, evidence report (native device/window checks remain explicitly unverified).

## Starting state

work/ui HEAD 904a5cf6; fetched origin/main is already an ancestor (ahead 2, behind 0).
Existing dirty UI, project setup, timeline comparison and Core changes are retained.
No initial commit/stash/reset is permitted to absorb or move those changes.
Android orientation and phone panels delegated to independent agents; parent owns composition and packaging, separate agent owns readonly Core transport.

## Decisions and evidence

Ruling: existing app composition imports editing eagerly. Separate product entrypoints and extract shared rendering/session responsibilities, rather than hide editor controls in viewer DOM.

Implementation and focused verification evidence are recorded in [the canonical report](https://github.com/kimjeon-il/PandoLab-library-data/blob/f4ae4d70579b8c799fba2e507e1a948b7e1e42c2/reports/development/testing/web-app-product-split-2026-10-18.md). Native Android device rotation and a running Windows native window remain unverified; browser viewport checks do not replace those checks.
