# Historical library geometry builds

`east-germany-1989.recipe.json` is the pinned, declarative build recipe for the
PandoLab historical-country pilot `historical-country:deutsche-demokratische-republik`.

The normal build is offline and deterministic:

```powershell
python -m pip install -r tools/requirements-historical-library.txt
pnpm build:historical-library
pnpm check:historical-library
```

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

`python tools/fetch-east-germany-sources.py` explicitly refreshes the source
subsets. It is not part of the normal build because BKG is updated annually.
After a deliberate refresh, review the geometry and update the recipe SHA-256
values before committing. CShapes is not an input and no CShapes-derived
coordinate is distributed.

The recipe performs union, difference and canonical-boundary reconciliation.
The Berlin mask is polygonized in EPSG:25833 and uses the smallest linework snap
that closes the West Berlin cell, never exceeding the recipe's 100 m limit. A
failure to close the boundary stops the build rather than interpolating a
replacement line.

## Additional historical-country entries

`assets/data/historical-library-pilot.json` also contains six territory-replacement
entries built from the canonical Natural Earth Admin 0 polygons. They are
reference-date approximations, not a claim of cadastral historical precision:

- `historical-country:ukraine-1991-2014`: current Ukraine plus the canonical
  Russian Crimea component, through 17 March 2014.
- `historical-country:kingdom-of-yugoslavia`: the Kingdom of Yugoslavia,
  1918–1941.
- `historical-country:sfr-yugoslavia`: the Socialist Federal Republic of
  Yugoslavia, 1945–1992.
- `historical-country:federal-republic-of-yugoslavia`: Serbia, Montenegro and
  Kosovo as the Federal Republic of Yugoslavia, 1992–2003.
- `historical-country:sudan-1956-2011`: present Sudan plus South Sudan through
  8 July 2011.
- `historical-country:indonesia-1945-2002`: present Indonesia plus Timor-Leste
  through 19 May 2002.

All six use the same `territory-replacement` materialization mode, so adding one
subtracts its transferred geometry from overlapping current-country objects in
one undoable operation.
