# DDR remaining borders and map alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue remaining DDR 1989-04-25 border sections with suitable vectors first; present aligned paper maps before any tracing.

**Architecture:** Preserve the existing country source, C++ recipe and source pins. Store research and previews in the external library report working copy. A paper-map preview is an approval boundary, not permission to digitize a boundary.

**Tech Stack:** Official WFS/WMS and archives; GeoJSON/GeoPackage; Python projection/image tools; current Pando recipe generators only when a vector section is admitted.

**Spec:** User instructions in this chat, 2026-10-23; docs/historical-border-reconstruction-policy.md; docs/historical-vector-source-workflow.md.

## Global Constraints

- Reuse work/gis, preserve unrelated changes and branch-specific data/WASM.
- Reference date 1989-04-25; coast and West Berlin remain outside this task.
- Use period geometry or demonstrate continuity before adopting modern vectors.
- Present a georeferenced map with alignment provenance, existing boundary and uncertainty before tracing; wait for user approval for that map/section.
- Do not align a historical map to the boundary being evaluated. Protect independent control/check points.
- No historical 0.5px pass without an independent period boundary. Baseline flatZoom64, 2560 CSS px; topology/ownership/date override display tolerance.
- No broad checks, benchmarks, native rebuild, main merge, push or deployment.

## Review Focus

- Fence/patrol road must not be mistaken for the state boundary.
- Map publication/revision must not silently substitute for the target date.
- Riverbank, thalweg and disputed borders need explicit source interpretation.
- Neuhaus 1993 transfers must not be copied backward from modern administration.
- A provider-georeferenced WMS has no locally measured GCP residual unless independent controls are actually measured.

## Task 1: Existing-vector and map inventory

**Files:** External reports/geography/east-germany-remaining-map-preview-2026-10-23/ and its Markdown report; reports/README.md.

- [ ] Reuse prior sources, inspect official vector availability for every held region, and record actual data date, CRS, license and resolution.
- [x] Reject coarse overview vectors as detailed replacement even when they have the correct date.
- [x] Acquire a suitable period 1:25,000 map for the first paper-map interval and preserve original bytes, URL and hash.

## Task 2: Alignment preview and user gate

**Files:** External source manifest, alignment metadata, original map and preview PNGs.

- [x] Use authoritative provider georeferencing or independent grid/control coordinates; record method and measured/unmeasured errors.
- [x] Show raw aligned raster, existing DDR boundary and pinned VG25 candidate as separately identified overlays. Do not draw a proposed historical line.
- [x] Inspect the preview visually and report date/coverage/coordinate uncertainties.
- [x] Present the preview to the user. Stop tracing for this interval until the user confirms it.

## Task 3: Eligible vector application (only when independently admitted)

**Files:** Existing tools/historical-library/east-germany-1989.recipe.json and external country sources/derivatives; affected focused tests.

- [x] Admit only source-supported vector intervals; preserve all other sectors and record the source pin.
- [x] Regenerate only changed dependencies through the existing app-owned generators.
- [x] Run the smallest geometry and affected workflow checks once; update corresponding regression coverage.
- [x] Store evidence and report, commit locally, and leave main/remote deployment unchanged.

2026-10-23 batch: user approved the 10km/30km northern map previews. Applied only Ratzeburg/southern Wakenitz and Kiekbusch/Mechower western-shore VG25 windows (10 arcs). Period-map-derived production tracing was unnecessary. Exact-date independent positional accuracy remains unmeasured. Other held regions require further documentary/vector/map work; this checklist does not claim all remaining sectors complete. Focused checks: Python10, import/mesh1, Web/App workflow1 passed. Existing Czechoslovakia compiler exclusion remains unchanged and is reported separately.

## Continuation: every remaining sector

- [x] Inventory every held region, retain known period/source/topology exceptions, and search authoritative historical vector/raster services.
- [x] Read LGLN2016 marker/survey-record continuity and its Elbe/Warme Bode exceptions; combine regional evidence with fixed VG25.
- [x] Apply9 further admitted windows through existing recipe crossing-to-crossing operation; preserve eight explicitly held water/coast regions.
- [x] Update frozen baselines/affected regressions; witness new test fail before generation and11 focused Python cases pass after generation.
- [x] Prepare4 new provider-georeferenced period-map previews with per-sheet metadata and gaps identified; show them before tracing.
- [x] Receive user review for these4 actual previews, then reconstruct only historically interpretable covered parts. Other missing period maps remain work to do.
- [x] Digitize the approved maps' actual political-boundary symbols, preserve raster/masters separately, and apply historically interpretable covered arcs through the canonical recipe. Elbe competing-claim and dated-map uncertainty must stay explicit.
- [x] Finish runtime dependencies, focused import/mesh and Web/App workflow, final review; archive and local commit after final evidence is written.

Base app8526d2b5 / data bfc9adcc. Read-only whole-batch review at the end; no broad suites, no release.137 logged replacement operations do not mean137 independent new historical boundary segments or complete replacement of the9 geographic regions. A candidate southeastern Eichsfeld window was rejected for having no admissible crossing. Report: reports/geography/east-germany-remaining-all-2026-10-23.md.

Approved map phase: Delvenau covered window reuses VG25 (8logged operations); Neuhaus/Schnackenburg printed Elbe claim references connect only actual crossing arcs (3+2). Raw rasters/masters remain private; external derived-use licensing unresolved, local provisional only. Broad tripoint candidate rejected for conflict/reversing fragments against preserved international LSIB; narrow trial no substantive delta. Final reviewer found one Neuhaus nonclosed tracing backtrack; approved raster reread, unsupported overshoot vertex removed, failing directional regression added, focused Python13PASS. Final runtime/source/transport+compiled-scope evidence stored; final Web/App1PASS with6144MiB Node heap after one process-level failure; cause unconfirmed. No more checks.
