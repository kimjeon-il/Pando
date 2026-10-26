# Historical library geometry builds

## Mandatory historical boundary reconstruction standard

Historical national/subnational borders, rivers, coastlines and reclamation
geometry follow the shared [historical boundary reconstruction policy](../../docs/historical-border-reconstruction-policy.md).
The standard prioritizes macro territorial change and matches display detail to
**Natural Earth 1:10,000,000 (1:10M)**. Normally omit small parcel exchanges,
minor deposition/erosion, river shifts and seasonal water-level/flow changes;
retain historically important small exceptions concerning state existence or
major city/island attribution, with a recorded reason. Use suitable period
sources without requiring a detailed source scale or tracing every bend.
Preserve original evidence and master geometry, then generalize a separate
display derivative against the Natural Earth reference at the same extent and
projection. Stop when the selected history, recognizable shape and necessary
shared-border topology are supported. Maximum app zoom does not impose further
historical reconstruction work. Existing vectors and renderer/mesh accuracy
checks are not changed by this policy; no universal deletion distance is implied.


`east-germany-1989.recipe.json` is the pinned, declarative build recipe for the
PandoLab historical-country pilot `state:deutsche-demokratische-republik`.

The normal build uses offline source data. The GEOS/PROJ C++ recipe engine
constructs the polygon and the shared C++ spherical polygon normalizer sets
its winding. Build the pinned native toolchain before generating or checking
the catalog geometry:

```sh
micromamba create -y -f tools/cpp/territorial-recipe-environment.yml
micromamba run -n pando-territorial-recipe cmake -S tools/cpp -B build-native/territorial-recipe -G Ninja -DPANDO_BUILD_COUNTRY_VALIDATOR=OFF -DPANDO_BUILD_TERRITORIAL_RECIPE=ON
micromamba run -n pando-territorial-recipe cmake --build build-native/territorial-recipe --target pando-territorial-recipe
PANDO_TERRITORIAL_RECIPE_BINARY="$PWD/build-native/territorial-recipe/pando-territorial-recipe" micromamba run -n pando-territorial-recipe node tools/build-territorial-geometry.mjs --check
```

The optional `.github/workflows/gis-python-p4.yml` `historical-geometry`
job builds the C++ recipe engine only when explicitly selected through the
GIS-only workflow. The ordinary `application-architecture.yml` `data-contracts`
job independently checks preview assets, catalog chunks and version contracts
without importing Python or running raw GIS reconstruction. The stored geometry check
requires identical component, ring and vertex structure, with at most
`2e-12` degrees coordinate drift for cross-platform projection rounding.

The checked-in files below are the only geometry inputs used by that build:

- Natural Earth Admin 1 v5.1.1: `DE-BB`, `DE-BE`, `DE-MV`, `DE-SN`, `DE-ST`,
  and `DE-TH` only. Natural Earth data is public domain.
- BKG VG250: Berlin Land and Amt Neuhaus (`AGS 03355049`). Attribution:
  **© BKG 2026 dl-de/by-2-0**, Datenlizenz Deutschland – Namensnennung –
  Version 2.0.
- Berlin Open Data, *Verlauf der Berliner Mauer, 1989*: physical front-wall
  linework and political-boundary deviations. Datenlizenz Deutschland – Zero –
  Version 2.0. The source was manually transferred from the 25 April 1989 aerial
  image to a 1:5,000 map and is not parcel-accurate.
- PandoLab's canonical `DEU` polygon from Natural Earth Admin 0 v5.1.1, used to
  reuse the exact Baltic/coast/Poland/Czech exterior boundary.

`node tools/fetch-east-germany-sources.mjs --mode full` prepares a read-only
candidate inventory. Add `--execute` only after reviewing the pinned BKG and
Natural Earth source scope; it writes exclusively to previously absent files.
`--mode vg25` captures the five eastern states, while `--mode vg25-captured`
rechecks an existing capture and its adopted canonical DEU exterior. Use
`--output-dir` to stage new candidates outside the approved source root.
Unlike the old Python collector, existing approved originals are never
overwritten. Reviewed candidate bytes and source hashes must be explicitly
accepted into the recipe after comparing the provenance; BKG updates annually. CShapes is not an input and no CShapes-derived
coordinate is distributed.

The recipe performs union, difference and canonical-boundary reconciliation.
The Berlin mask is polygonized in EPSG:25833 and uses the smallest linework snap
that closes the West Berlin cell, never exceeding the recipe's 100 m limit. A
failure to close the boundary stops the build rather than interpolating a
replacement line.

## Additional historical-country entries

The current/historical geometry catalog stores each continuing political identity under a
**single entity ID**, while `geometryVersions` choose its dated territorial footprint.
All pre-2026 national outlines below are provisional historical approximations unless
independently verified against appropriate period maps:

- `state:UKR` (Ukraine): Crimea-inclusive historical version through 17 March 2014;
  a Crimea-excluded modern-outline proxy from 18 March 2014; unchanged current
  geometry from 6 October 2026.
- `state:SDN` (Sudan): pre-secession outline including South Sudan through
  8 July 2011; a post-secession proxy from 9 July 2011.
- `state:SDS` (South Sudan): independent from 9 July 2011, without borrowing
  Sudan's predecessor identity.
- `state:IDN` (Indonesia): five versions. West New Guinea is excluded before
  1 May 1963 (25 Natural Earth 5.1.1 components of Papua/West Papua from the
  [pinned component mask](sources/indonesia/west-new-guinea-component-mask-v5.1.1.json));
  occupied East Timor is approximated as included from 7 December 1975 through
  24 October 1999; from 25 October 1999 it is excluded.
- `state:TLS` (Timor-Leste): independent state from 20 May 2002, with historical
  proxy and current geometry versions. The 1999–2002 UN transitional territory
  is **not** misclassified as an independent Timor-Leste state.
- `state:yugoslavia`: existing multiple historical versions remain independently
  catalogued pending the separate successor-state identity audit.

Each historical version may set its own `instantiation.mode = territory-replacement`
without changing the identity-level modern `independent` policy. Geometry validity,
state lifetime, and international legal title are separate concepts. The 1963 Papua
and 1975/1999 Timor boundaries represent administrative transfer and approximate
effective control, not a newly recognized sovereign title.

The older standalone helper `tools/indonesia-territory-periods-2026.mjs` was not
used to produce the validated catalog. Its longitude-only Papua filter does not
match the independently audited 25-component mask and must not be used in
place of the pinned source and `GEO-IDN-001` report.

## German coastline changes across eras

The [coastline event/source index](sources/german-coastline/README.md) and
[`change-events.json`](sources/german-coastline/change-events.json) record
coastal engineering and land/water changes across the German Empire,
German Reich (1919–1945), and later periods **without assigning each change to
a permanent country owner or inventing a precise completion date**.

The index currently records historical sources, construction/closure year
ranges and the available Pillau/Zimmerbude/Gdynia map-sheet series. It is
**research evidence, not digitized shoreline geometry**. Do not promote an
event into a dated polygon until independent period maps have established its
location, geometry, actual land/water classification and applicable dates.
The present German Empire 1914 working geometry still has provisional modern
coastline sections.

Validate its data contract with
`node --test tests/unit/historical-german-coastline-events.test.mjs`.

## German Empire 1914 working base

`german-empire-1914-base.recipe.json` defines the reproducible working-base
pipeline for the German Empire immediately before the First World War
(reference date 1914-07-31). Unlike the distributable East Germany pilot, the
HGIS source and its generated derivative are kept local because the HGIS
metadata restricts use to non-commercial academic research unless separately
licensed.

Prepare the source and build the working base with:

```powershell
node tools/fetch-german-empire-1914-source.mjs
python tools/build_german_empire_1914_base.py
python tools/build_german_empire_1914_base.py --check
```

If Harvard/NYU WFS access is unavailable, download **Germany State Boundaries,
1914, German Historical GIS** manually, convert it to EPSG:4326 GeoJSON, then:

```powershell
node tools/fetch-german-empire-1914-source.mjs --from-file PATH_TO_GEOJSON
```

The build performs these steps deterministically:

1. Validate the local HGIS source as the 26-state 1914 dataset and check its
   envelope against the catalog metadata.
2. Apply the OSHistory linear HGIS correction with the published west-east
   coefficients on longitude and south-north coefficients on latitude.
   This is an intentional axis-correct port: upstream `transform-coords.py`
   passes the longitude coefficients to both coordinate axes despite shipping
   separate WE and SN coefficient files.
3. Dissolve all corrected state polygons into one German Empire base.
4. Clear the Heligoland work window and insert the exact Heligoland + Düne
   components from PandoLab's canonical Natural Earth v5.1.1 `DEU` geometry.
5. Validate geometry, area, historical inside/outside control points, and the
   isolation of the Heligoland patch.

The generated base and diagnostics are written below
`tools/historical-library/generated/` and are gitignored. The checked-in
`tools/historical-library/working/` artifacts preserve the reviewed 1914
working geometry and modern-coastline variants used by the GIS reconstruction
workflow.

The HGIS source contract and local-file policy are documented in
`sources/german-empire-1914/README.md`.

## Worldwide event-based shoreline pilot (October 2026)

The [global historical coastline change workflow](../../docs/historical-coastline-change-workflow.md) reuses the German coastline event catalogue instead of duplicating it by sovereign or year. Its [read-only catalogue registry](sources/coastline-catalogs.json) references the existing German and new Dutch inventories without duplicating event records. The Netherlands pilot adds a [nine-event source index](sources/netherlands/change-events.json), [twelve read-only national-polygon point probes](sources/netherlands/canonical-phase0-probes.json), and a [Phase 0 audit](https://github.com/kimjeon-il/PandoLab-library-data/blob/f4ae4d70579b8c799fba2e507e1a948b7e1e42c2/reports/geography/netherlands/phase0-canonical-audit.md).

The Dutch sample audit established that the current NLD national polygon covers inland-water positions and does not prove whether small artificial islands/lake masks are represented. It also places the published Maasvlakte 2 sample point outside the present national outline. All historical geometry, hydrology and contemporary canonical files remain unchanged; the probes are **not** a verified shoreline or polygon rollback. Run `node --test tests/unit/historical-netherlands-coast-phase0.test.mjs` after syncing the GIS branch to a local worktree to reproduce the regression assertions.

# Focused C++ recipe equivalence check

`tools/cpp/territorial-recipe-environment.yml` pins GEOS 3.13.1 and PROJ
9.5.1 to the versions used by the current Shapely/pyproj DDR oracle. On a
Linux host with micromamba, build and compare the C++ geometry against the
curated DDR version without writing any assets:

```sh
micromamba create -y -f tools/cpp/territorial-recipe-environment.yml
micromamba run -n pando-territorial-recipe cmake -S tools/cpp -B build-native/territorial-recipe -G Ninja -DPANDO_BUILD_COUNTRY_VALIDATOR=OFF -DPANDO_BUILD_TERRITORIAL_RECIPE=ON
micromamba run -n pando-territorial-recipe cmake --build build-native/territorial-recipe --target pando-territorial-recipe
PANDO_TERRITORIAL_RECIPE_BINARY="$PWD/build-native/territorial-recipe/pando-territorial-recipe" micromamba run -n pando-territorial-recipe node --test tests/unit/territorial-recipe-cpp.test.mjs
```

The focused test checks all five source SHA-256 values, component/ring/vertex
structure and coordinate values within the measured projection rounding.
The active generation entrypoint is
`PANDO_TERRITORIAL_RECIPE_BINARY="$PWD/build-native/territorial-recipe/pando-territorial-recipe" node tools/build-territorial-geometry.mjs --check`.
It verifies pinned inputs, invokes the C++ recipe engine and compares only the
target geometry version while preserving curated catalog identity and metadata.


### Historical boundary linework (GEOS/PROJ)

Run `node tools/gis/verify-historical-linework.mjs --input FILE.geojson --expected-sha256 SHA256` with `PANDO_TERRITORIAL_RECIPE_BINARY` pointing at the standalone native recipe engine. Inputs are SHA-pinned and read-only. Shared endpoints are permitted; interior crossings, overlaps, T-junctions and self-intersections fail. The geometry and source evidence are neither rewritten nor promoted to a new national border.
