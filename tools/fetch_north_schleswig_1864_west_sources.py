#!/usr/bin/env python3
import json, pathlib, re, requests

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/"tools/historical-library/sources/german-empire-1914/north-schleswig"
OUT.mkdir(parents=True,exist_ok=True)
UA={"User-Agent":"PandoLab-NorthSchleswig1864/1.0"}

REL_ID=11260903
REL_URL=f"https://api.openstreetmap.org/api/0.6/relation/{REL_ID}/full.json"
OVERPASS="https://overpass-api.de/api/interpreter"

def get_json(url, **kwargs):
    r=requests.get(url,headers=UA,timeout=120,**kwargs)
    r.raise_for_status()
    return r.json()

rel=get_json(REL_URL)
(OUT/"graensestien-relation-11260903-full.json").write_text(json.dumps(rel,ensure_ascii=False,separators=(",",":")),encoding="utf-8")

# Reconstruct all relation member ways with coordinates, preserving relation-member order.
elems=rel.get("elements",[])
nodes={e["id"]:(e["lon"],e["lat"]) for e in elems if e.get("type")=="node"}
ways={e["id"]:e for e in elems if e.get("type")=="way"}
relation=next(e for e in elems if e.get("type")=="relation" and e.get("id")==REL_ID)
member_ways=[]
for m in relation.get("members",[]):
    if m.get("type")!="way" or m.get("ref") not in ways:
        continue
    w=ways[m["ref"]]
    coords=[nodes[n] for n in w.get("nodes",[]) if n in nodes]
    if len(coords)>=2:
        member_ways.append({"wayId":m["ref"],"role":m.get("role",""),"tags":w.get("tags",{}),"coordinates":coords})

# Join relation ways greedily by endpoints into route chains.
def key(p,tol=1e-7): return (round(p[0]/tol),round(p[1]/tol))
chains=[x["coordinates"][:] for x in member_ways]
changed=True
while changed:
    changed=False
    outer=False
    for i in range(len(chains)):
        if outer: break
        for j in range(i+1,len(chains)):
            a,b=chains[i],chains[j]
            merged=None
            if key(a[-1])==key(b[0]): merged=a+b[1:]
            elif key(a[-1])==key(b[-1]): merged=a+list(reversed(b[:-1]))
            elif key(a[0])==key(b[-1]): merged=b+a[1:]
            elif key(a[0])==key(b[0]): merged=list(reversed(b))+a[1:]
            if merged:
                chains[i]=merged; chains.pop(j); changed=True; outer=True; break

route_geo={"type":"FeatureCollection","features":[
    {"type":"Feature","properties":{"source":"OSM relation 11260903","chainIndex":i,"coordinateCount":len(c)},"geometry":{"type":"LineString","coordinates":c}}
    for i,c in enumerate(chains)
]}
(OUT/"graensestien-route-reference.geojson").write_text(json.dumps(route_geo,ensure_ascii=False,separators=(",",":")),encoding="utf-8")

# Boundary stones/markers in western sector, broad enough to include marker 1 through Gelsbro.
query=r"""[out:json][timeout:90];
(
  node["historic"="boundary_stone"](55.255,8.63,55.390,8.990);
  node["historic"="boundary_marker"](55.255,8.63,55.390,8.990);
  node["boundary"="marker"](55.255,8.63,55.390,8.990);
  node["man_made"="survey_point"](55.255,8.63,55.390,8.990);
);
out body;"""
rr=requests.post(OVERPASS,data={"data":query},headers=UA,timeout=120)
rr.raise_for_status()
markers=rr.json()
(OUT/"west-boundary-markers-overpass.json").write_text(json.dumps(markers,ensure_ascii=False,separators=(",",":")),encoding="utf-8")

# Normalize likely 1864-1920 border stones and parse numeric references.
def numref(tags):
    vals=[]
    for k in ("ref","name","inscription","description","note","old_ref"):
        v=str(tags.get(k,""))
        vals+=re.findall(r"(?<!\d)(\d{1,3}[a-zA-Z]?)(?!\d)",v)
    for v in vals:
        m=re.match(r"(\d+)",v)
        if m:
            n=int(m.group(1))
            if 1<=n<=128:
                return n,v
    return None,None

candidates=[]
for e in markers.get("elements",[]):
    tags=e.get("tags",{})
    n,raw=numref(tags)
    text=" ".join(str(v) for v in tags.values()).lower()
    historical_hint=any(s in text for s in ("1864","1920","grænse","grense","grenze","kr. pr","kr. dm","preussen","preußen"))
    if n is not None or historical_hint:
        candidates.append({
            "osmNodeId":e["id"],"lon":e["lon"],"lat":e["lat"],"number":n,"rawRef":raw,"historicalHint":historical_hint,"tags":tags
        })
candidates.sort(key=lambda x:(999 if x["number"] is None else x["number"],x["lon"]))

marker_fc={"type":"FeatureCollection","features":[
    {"type":"Feature","id":f"osm-node-{x['osmNodeId']}","properties":{k:v for k,v in x.items() if k not in ("lon","lat")},"geometry":{"type":"Point","coordinates":[x["lon"],x["lat"]]}}
    for x in candidates
]}
(OUT/"west-boundary-marker-candidates.geojson").write_text(json.dumps(marker_fc,ensure_ascii=False,separators=(",",":")),encoding="utf-8")

summary={
    "relationId":REL_ID,
    "relationWayCount":len(member_ways),
    "routeChainCount":len(chains),
    "routeChainCoordinateCounts":[len(c) for c in chains],
    "overpassMarkerCount":len(markers.get("elements",[])),
    "candidateCount":len(candidates),
    "numberedCandidates":[{"number":x["number"],"osmNodeId":x["osmNodeId"],"lon":x["lon"],"lat":x["lat"],"rawRef":x["rawRef"]} for x in candidates if x["number"] is not None],
}
(OUT/"west-source-summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(summary,ensure_ascii=False,indent=2))
