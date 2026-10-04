#!/usr/bin/env python3
import json, math, pathlib, requests
from shapely.geometry import shape, mapping, box, Point, MultiPolygon, Polygon
from shapely.ops import unary_union, transform
from shapely.validation import explain_validity
from pyproj import Transformer

ROOT=pathlib.Path(__file__).resolve().parents[1]
WORLD=ROOT/"assets/data/countries-ne-5.1.1.geojson"
OUTDIR=ROOT/"tools/historical-library/working"
SRCDIR=ROOT/"tools/historical-library/sources/german-empire-1914"
OUTDIR.mkdir(parents=True,exist_ok=True); SRCDIR.mkdir(parents=True,exist_ok=True)

HGIS_URL="https://raw.githubusercontent.com/acdh-oeaw/histogis-data/master/single_files/deutsches-reich__1871-02-27_1919-12-31.geojson"
PLEIADES_URL="https://raw.githubusercontent.com/isawnyu/pleiades.datasets/main/data/json/9/8/9/98907.json"
DUNE_OSM="https://api.openstreetmap.org/api/0.6/way/273992076/full.json"
TARGET={"DEU","DNK","POL","RUS","LTU"}

def get_json(url):
    r=requests.get(url,timeout=60,headers={"User-Agent":"PandoLab-GermanEmpire1914/1.0"})
    r.raise_for_status(); return r.json()

TARGET_ALIASES={
    "DEU":{"DEU","Germany","Deutschland","Federal Republic of Germany"},
    "DNK":{"DNK","Denmark","Danmark","Kingdom of Denmark"},
    "POL":{"POL","Poland","Polska","Republic of Poland"},
    "RUS":{"RUS","Russia","Russian Federation","Российская Федерация"},
    "LTU":{"LTU","Lithuania","Lietuva","Republic of Lithuania"},
}
def target_code(feature):
    vals=[]
    if feature.get("id") is not None: vals.append(str(feature.get("id")))
    for v in (feature.get("properties") or {}).values():
        if isinstance(v,(str,int,float)): vals.append(str(v))
    exact={v.strip() for v in vals}
    for code,aliases in TARGET_ALIASES.items():
        if exact & aliases: return code
    return None

def clean(g):
    if not g.is_valid: g=g.buffer(0)
    return g

with WORLD.open(encoding="utf-8") as f: world=json.load(f)
features=world["features"]
target_parts=[]
found_codes=[]
for f in features:
    code=target_code(f)
    if code in TARGET:
        found_codes.append(code)
        target_parts.append(clean(shape(f["geometry"])))
if set(found_codes)!=TARGET:
    sample=[{"id":f.get("id"),"properties":f.get("properties",{})} for f in features[:3]]
    raise SystemExit("target current-country geometries incomplete: found="+repr(sorted(set(found_codes)))+" sample="+repr(sample))
modern_target=clean(unary_union(target_parts))

hgis=get_json(HGIS_URL)
historical=clean(shape(hgis["geometry"]))

# Reconstruct Helgoland main-island ring from Pleiades-preserved OSM relation 3787052.
pl=get_json(PLEIADES_URL)
loc=next(x for x in pl["locations"] if "3787052" in str(x.get("provenance","")))
lines=[[(float(x),float(y)) for x,y in line] for line in loc["geometry"]["coordinates"]]
def k(p,tol=1e-6): return (round(p[0]/tol),round(p[1]/tol))
chains=[x[:] for x in lines]
changed=True
while changed:
    changed=False
    for i in range(len(chains)):
        if changed: break
        for j in range(i+1,len(chains)):
            a,b=chains[i],chains[j]
            merged=None
            if k(a[-1])==k(b[0]): merged=a+b[1:]
            elif k(a[-1])==k(b[-1]): merged=a+list(reversed(b[:-1]))
            elif k(a[0])==k(b[-1]): merged=b+a[1:]
            elif k(a[0])==k(b[0]): merged=list(reversed(b))+a[1:]
            if merged:
                chains[i]=merged; chains.pop(j); changed=True; break
if len(chains)!=1: raise SystemExit(f"Helgoland chain reconstruction failed: {len(chains)}")
helgo=clean(Polygon(chains[0]))

# Düne direct OSM way.
od=get_json(DUNE_OSM)
nodes={e["id"]:(e["lon"],e["lat"]) for e in od["elements"] if e.get("type")=="node"}
way=next(e for e in od["elements"] if e.get("type")=="way" and e.get("id")==273992076)
dune=clean(Polygon([nodes[n] for n in way["nodes"]]))

# Project for meter-based coastal surgery.
to_m=Transformer.from_crs("EPSG:4326","EPSG:3035",always_xy=True).transform
to_w=Transformer.from_crs("EPSG:3035","EPSG:4326",always_xy=True).transform
H=transform(to_m,historical); T=transform(to_m,modern_target)

# Only the present North Sea/Baltic-facing boundary of DEU/DNK/POL/RUS/LTU is eligible.
sea_window=unary_union([
    box(4.5,52.7,11.5,56.7),   # North Sea / western Baltic
    box(8.0,52.7,24.0,56.7),   # Baltic to Memel
])
SW=transform(to_m,sea_window)
coast_candidate=T.boundary.intersection(SW)
COAST_BUFFER_M=30000
H_MATCH_BUFFER_M=30000
zone=coast_candidate.buffer(COAST_BUFFER_M)
modern_patch=T.intersection(zone).intersection(H.buffer(H_MATCH_BUFFER_M))
modernized=clean(H.difference(zone).union(modern_patch))

# Force high-resolution Helgoland/Düne, replacing any lower-resolution modern components there.
IH=transform(to_m,helgo); ID=transform(to_m,dune)
island_clear=IH.buffer(5000).union(ID.buffer(5000))
modernized=clean(modernized.difference(island_clear).union(IH).union(ID))

if modernized.geom_type=="Polygon": modernized=MultiPolygon([modernized])
elif modernized.geom_type!="MultiPolygon":
    polys=[g for g in getattr(modernized,"geoms",[]) if g.geom_type=="Polygon"]
    modernized=MultiPolygon(polys)
modernized=clean(modernized)
W=transform(to_w,modernized)

# Diagnostics.
changed=H.symmetric_difference(modernized)
changed_outside=changed.difference(zone.buffer(1))
changed_outside_km2=changed_outside.area/1e6
if changed_outside_km2>0.01:
    raise SystemExit(f"inland geometry changed outside coast zone: {changed_outside_km2:.6f} km2")
if not modernized.is_valid:
    raise SystemExit("invalid result: "+explain_validity(modernized))
for name,pt,expected in [
    ("Berlin",(13.405,52.52),True),("Strasbourg",(7.7521,48.5734),True),
    ("Poznan",(16.9252,52.4064),True),("Danzig",(18.6466,54.352),True),
    ("Memel",(21.1443,55.7033),True),("Warsaw",(21.0122,52.2297),False),
    ("Copenhagen",(12.5683,55.6761),False),("Prague",(14.4378,50.0755),False)
]:
    got=W.contains(Point(*pt)) or W.touches(Point(*pt))
    if got!=expected: raise SystemExit(f"control point failed: {name} got={got}")

src_hgis=SRCDIR/"histogis-deutsches-reich-1871-1919.geojson"
src_hgis.write_text(json.dumps(hgis,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
(SRCDIR/"helgoland-osm-preserved.geojson").write_text(json.dumps({"type":"Feature","properties":{"name":"Helgoland","source":"Pleiades-preserved OSM relation 3787052"},"geometry":mapping(helgo)},ensure_ascii=False,separators=(",",":")),encoding="utf-8")
(SRCDIR/"dune-osm-way-273992076.geojson").write_text(json.dumps({"type":"Feature","properties":{"name":"Düne","source":"OpenStreetMap way 273992076"},"geometry":mapping(dune)},ensure_ascii=False,separators=(",",":")),encoding="utf-8")

feature={"type":"Feature","id":"historical-country:deutsches-reich:1914-modern-coast-r1","properties":{
    "name":"Deutsches Reich","englishName":"German Empire","referenceDate":"1914-07-31",
    "status":"working-base-modern-coastline",
    "coastlineBasis":"Current website DEU/DNK/POL/RUS/LTU coastline; historical land borders retained outside coastal surgery zone",
    "coastlineNote":"Intermediate geometry only. Modern coastline will later be replaced by a reconstructed 1914 coastline.",
    "heligoland":"High-resolution modern Helgoland/Düne geometry retained."
},"geometry":mapping(W)}
out={"type":"FeatureCollection","name":"pandolab-german-empire-1914-modern-coast-r1","features":[feature]}
(OUTDIR/"german-empire-1914-modern-coast.geojson").write_text(json.dumps(out,ensure_ascii=False,separators=(",",":")),encoding="utf-8")

diag={
    "referenceDate":"1914-07-31",
    "inputs":{"websiteCountries":sorted(TARGET),"coastBufferMeters":COAST_BUFFER_M,"historicalMatchBufferMeters":H_MATCH_BUFFER_M},
    "validation":{
        "valid":modernized.is_valid,
        "geometryType":modernized.geom_type,
        "componentCount":len(modernized.geoms),
        "historicalAreaKm2":round(H.area/1e6,3),
        "modernCoastAreaKm2":round(modernized.area/1e6,3),
        "symmetricDifferenceKm2":round(changed.area/1e6,3),
        "differenceOutsideCoastZoneKm2":round(changed_outside_km2,6),
        "helgolandAreaKm2":round(IH.area/1e6,6),
        "duneAreaKm2":round(ID.area/1e6,6),
        "boundsWGS84":[round(v,7) for v in W.bounds]
    },
    "notes":[
        "This is an intermediate working base: modern coastline + historical inland frontier.",
        "Coastal land-border endpoints are temporary and will be re-snapped after 1914 shoreline reconstruction.",
        "No intended geometry change outside the 30 km modern-coast surgery zone."
    ]
}
(OUTDIR/"german-empire-1914-modern-coast.diagnostics.json").write_text(json.dumps(diag,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(diag,ensure_ascii=False,indent=2))
