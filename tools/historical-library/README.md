# Historical library geometry builds

`east-germany-1989.recipe.json` is the pinned, declarative build recipe for the
PandoLab historical-country pilot `historical-country:east-germany`.

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
