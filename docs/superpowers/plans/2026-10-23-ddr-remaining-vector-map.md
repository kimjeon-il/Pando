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
