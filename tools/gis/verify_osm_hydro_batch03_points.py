#!/usr/bin/env python3
"""Read-only third-batch Hydro name identity screen, systems 21–31.

Use NGA's non-OSM government gazetteer stream (STM) point features, Vietnam
MONRE's gazetted Ba Lai river termini and Japan MLIT's explicitly OFF-RIVER
rain-station reference. Independent point proximity is NOT a full named-vector
comparison. No production Hydro assets, metadata or aliases are changed.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

IDS = ("40475481","40486439","41023100","41067217","41109275",
       "41171836","41182380","41337891","41386179","41386700","41390476")

# These are actual published Hydro mainstem bounds from the independently
# reproduced Natural Earth comparison (not OSM relation bounding boxes).
BBOX={
  "40475481":[126.7854,35.7188,127.7146,36.5187],
  "40486439":[138.8208,35.6375,139.8521,36.1396],
  "41023100":[67.5331,24.0703,74.5083,32.4188],
  "41067217":[89.6229,23.2136,94.3563,28.5521],
  "41109275":[105.9458,22.3104,113.2585,23.5896],
  "41171836":[106.1688,20.698,106.6626,21.7812],
  "41182380":[104.4021,20.2896,106.5303,23.5479],
  "41337891":[100.0479,13.5984,101.1954,19.5521],
  "41386179":[106.7396,10.4998,108.6979,12.1896],
  "41386700":[105.6042,10.4354,106.7214,11.9292],
  "41390476":[105.8458,9.9325,106.4653,10.1687],
}
CRS={
 "40475481":"EPSG:32652","40486439":"EPSG:32654",
 "41023100":"EPSG:32642","41067217":"EPSG:32646",
 "41109275":"EPSG:32648","41171836":"EPSG:32648",
 "41182380":"EPSG:32648","41337891":"EPSG:32647",
 "41386179":"EPSG:32648","41386700":"EPSG:32648",
 "41390476":"EPSG:32648",
}
# Study competing named rivers together so one downstream Hydro MAIN_RIV
# logical group is not automatically classified as its first OSM alias.
QUERY_TERMS={
 "40475481":["Geum","Kum-gang","Keum","금강","Kŭm","Kumgang"],
 "40486439":["Arakawa","Ara-kawa","Tone","Tonegawa","荒川","利根"],
 "41023100":["Indus","Sindh","Ravi","Chenab","Panjnad","Sutlej"],
 "41067217":["Brahmaputra","Yarlung","Tsangpo","Jamuna","Padma","Ganges","Meghna","Tista"],
 "41109275":["Nanpan","Zuo","Yu Jiang","Yong","Xi Jiang","Xun","You Jiang","左江","邕江","郁江","浔江","西江","南盘"],
 "41171836":["Luc Nam","Lục Nam","Cau","Cầu","Thuong","Thương","Thai Binh"],
 "41182380":["Cau","Cầu","Red","Hồng","Hong","Black River","Thao","Da River"],
 "41337891":["Yom","Pa Sak","Pasak","Chao Phraya","Ping","Nan"],
 "41386179":["Dong Nai","Đồng Nai","La Nga","Srepok","Krong","Krông","Sai Gon","Saigon"],
 "41386700":["Vam Co","Vàm Cỏ","Saigon","Sài Gòn","Dong Nai","Nha Be"],
 "41390476":["Ba Lai","Mekong","Tien","Tiền","Hau","Hậu","Ham Luong","Hàm Luông","Co Chien","Cổ Chiên"],
}
GNS="https://geonames.nga.mil/geon-ags/rest/services/RESEARCH/GIS_OUTPUT/MapServer/0/query"
GNS_ABOUT="https://geonames.nga.mil/geonames/GNSHome/"
MONRE_2017="https://vupc.mae.gov.vn/Data/files/12-2017-tt-btnmt.pdf"
MLIT_ARAKAWA="https://www.ktr.mlit.go.jp/arage/suibou-info/common/html/rain2128100100001_10.html"
# MONRE Vietnam 2017 gazetteer table: start/end named Ba Lai watercourse
# (DMS -> WGS84 point). These are two official RIVER endpoint locations.
# They are NOT necessarily the boundaries of the Hydro pack.
EXTERNAL={
 "41390476":[
    {"id":"monre_2017_ba_lai_start","name":"sông Ba Lai official start","lon":106+11/60+14/3600,
     "lat":10+18/60+6/3600,"role":"government-registered-river-endpoint","source":MONRE_2017},
    {"id":"monre_2017_ba_lai_end","name":"sông Ba Lai official endpoint","lon":106+41/60+20/3600,
     "lat":10+2/60+18/3600,"role":"government-registered-river-endpoint","source":MONRE_2017}
 ],
 "40486439":[
    {"id":"mlit_iwabuchi_rain_rooftop","name":"Arakawa Iwabuchi RAIN station roof (NOT watercourse line)",
     "lon":139+44/60+46/3600,"lat":35+47/60+5/3600,
     "role":"MLIT-on-basin-building-roof-not-river-gauge","source":MLIT_ARAKAWA},
 ],
}
PLACE_ZONES={
 "41386179":[106.45,10.32,108.93,12.40],
 "41386700":[105.40,10.22,106.90,12.15],
}
def search_geonames(sid,all_rivers=False):
    w,s,e,n=PLACE_ZONES.get(sid,BBOX[sid])
    pad=0 if all_rivers else 0.42
    w-=pad;s-=pad;e+=pad;n+=pad
    where=(f"desig_cd = 'STM' AND lat_dd >= {s:.5f} AND lat_dd <= {n:.5f}"
           f" AND long_dd >= {w:.5f} AND long_dd <= {e:.5f}")
    if not all_rivers:
        names=QUERY_TERMS[sid]
        where+=" AND ("+" OR ".join("full_name LIKE '%"+t.replace("'","''")+"%'" for t in names)+")"
    query=urllib.parse.urlencode({
        "where":where,
        "outFields":"ufi,uni,lat_dd,long_dd,full_name,desig_cd,cc_ft",
        "returnGeometry":"false","resultRecordCount":"300" if all_rivers else "200",
        "f":"json"
    })
    url=GNS+"?"+query
    receipt={"systemId":sid,"kind":"all-streams-in-small-bbox" if all_rivers else "name-and-competing-names",
             "agency":"US National Geospatial-Intelligence Agency","where":where,"url":url,
             "status":"not-confirmed","features":[]}
    try:
        request=urllib.request.Request(url,headers={"Accept":"application/json","User-Agent":"PandoLab-independent-river-identity-audit/1.0"})
        with urllib.request.urlopen(request,timeout=24) as response:
            blob=response.read(8_000_001)
        if not blob or len(blob)>8_000_000:raise ValueError("NGA response truncated/oversized")
        raw=json.loads(blob)
        if "error" in raw:raise ValueError("NGA REST "+str(raw["error"]))
        rows=raw.get("features")
        if not isinstance(rows,list):raise ValueError("NGA REST missing features")
        receipt["status"]="queried"
        receipt["responseSha256"]=hashlib.sha256(blob).hexdigest()
        receipt["rawFeatureCount"]=len(rows)
        receipt["exceededTransferLimit"]=bool(raw.get("exceededTransferLimit"))
        # Alias rows: NGA can send English and local name records under same
        # UFI at the SAME coordinate; no double-counting as stations.
        by_location={}
        for record in rows:
            a=record.get("attributes") or {}
            if a.get("desig_cd")!="STM":continue
            lon,lat=a.get("long_dd"),a.get("lat_dd")
            if not isinstance(lon,(float,int)) or not isinstance(lat,(float,int)):continue
            if not(w<=lon<=e and s<=lat<=n):continue
            ident=a.get("ufi")
            if ident is None:continue
            key=(str(ident),round(lon,6),round(lat,6))
            if key not in by_location:
                by_location[key]={"id":"nga_"+str(ident),"ufi":ident,"lon":lon,"lat":lat,
                    "names":[],"role":"NGA-GNS-named-STM-point-not-line",
                    "source":GNS_ABOUT,"featureCountry":a.get("cc_ft")}
            label=str(a.get("full_name") or "").strip()
            if label and label not in by_location[key]["names"]:by_location[key]["names"].append(label)
        receipt["features"]=list(by_location.values())
        receipt["uniqueRiverPointCount"]=len(receipt["features"])
    except Exception as error:
        receipt["failureClass"]=type(error).__name__
        receipt["note"]="Service or query unavailable; not evidence that the named watercourse does not exist."
    return receipt

def get_lines(geometry):
    if geometry["type"]=="LineString":return[geometry["coordinates"]]
    if geometry["type"]=="MultiLineString":return geometry["coordinates"]
    raise ValueError("Only linear Hydro mainstems are eligible for this research screen")

def screen(system_id,features,points):
    from pyproj import Transformer
    from shapely.geometry import LineString,Point
    from shapely.ops import transform
    from shapely.strtree import STRtree
    transformer=Transformer.from_crs("EPSG:4326",CRS[system_id],always_xy=True)
    inverse=Transformer.from_crs(CRS[system_id],"EPSG:4326",always_xy=True)
    lines=[]
    for row in features:
        for coords in get_lines(row["geometry"]):
            if len(coords)>1:
                line=transform(transformer.transform,LineString(coords))
                if line.length>0:lines.append(line)
    if not lines:raise ValueError("No Hydro lines for "+system_id)
    tree=STRtree(lines)
    observations=[]
    for source in points:
        p=transform(transformer.transform,Point(source["lon"],source["lat"]))
        near=lines[int(tree.nearest(p))]
        q=near.interpolate(near.project(p))
        lon,lat=inverse.transform(q.x,q.y)
        observations.append({
            "pointId":source["id"],
            "names":source.get("names") or [source.get("name")],
            "publishedLonLat":[round(source["lon"],6),round(source["lat"],6)],
            "nearestHydroLonLat":[round(lon,6),round(lat,6)],
            "distanceKm":round(float(p.distance(q))/1000,3),
            "featureUfi":source.get("ufi"),
            "sourceRole":source["role"],"source":source["source"],
        })
    observations.sort(key=lambda row:row["distanceKm"])
    within1=sum(p["distanceKm"]<=1 for p in observations)
    within5=sum(p["distanceKm"]<=5 for p in observations)
    return {"systemId":system_id,"originalNameKo":features[0]["metadata"]["name"],
      "mainstemFeatures":len(features),"mainstemLineSegments":len(lines),
      "mainstemLengthKm":round(sum(s.length for s in lines)/1000,3),
      "independentPointChecks":observations,
      "pointCount":len(observations),"pointCountWithin1km":within1,"pointCountWithin5km":within5,
      "candidateIdentityConfirmed":False,"riverGeometryEdited":False}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--decoded",required=True,type=Path)
    ap.add_argument("--output",required=True,type=Path)
    args=ap.parse_args()
    decoded=json.loads(args.decoded.read_text())
    m=decoded["manifest"]
    if m.get("version")!="0.13.2" or m["metadata"].get("featureCount")!=16548:
        raise ValueError("Unexpected published Hydro geometry baseline")
    systems={sid:[] for sid in IDS}
    for row in decoded["features"]:
        meta=row["metadata"];sid=str(meta.get("systemId") or "")
        if sid in systems and meta.get("role")=="mainstem":systems[sid].append(row)
    if any(not rows for rows in systems.values()):
        raise ValueError("Missing any Hydro mainstem from eleven selected systems")
    probes=[(sid,False) for sid in IDS]
    probes += [(sid,True) for sid in ("41386179","41386700")]
    # Server failures are recorded individually; no false empty river proofs.
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        queried=list(pool.map(lambda pair:search_geonames(*pair),probes))
    by_system={sid:[] for sid in IDS}
    for result in queried:
        by_system[result["systemId"]].extend(result["features"])
    items=[]
    for sid in IDS:
        original=[*EXTERNAL.get(sid,[]),*by_system[sid]]
        # Multiple NGA query windows may report one UFI with differently
        # localized labels; a station's coordinates remain one observation.
        unique={}
        for anchor in original:
            key=(anchor["id"],round(anchor["lon"],6),round(anchor["lat"],6))
            if key not in unique:unique[key]=anchor
            elif anchor.get("names"):
                prior=unique[key].setdefault("names",[])
                for name in anchor["names"]:
                    if name not in prior:prior.append(name)
        items.append(screen(sid,systems[sid],list(unique.values())))
    outcome={
     "schema":"pando-hydro-osm-remaining-last11-ngo-government-point-screen-v1",
     "baseline":"HydroRIVERS v0.13.2",
     "originalBundleSha256":m["container"]["sha256"],
     "independentDataSource":"NGA GNS and named agency gazetteer endpoints",
     "governmentQueryCount":len(queried),
     "governmentQueryReceipts":queried,
     "systemsReviewed":len(items),
     "comparedIndependentPoints":sum(row["pointCount"] for row in items),
     "geoDataNotChanged":True,
     "sourceOnlyScreen":True,
     "approvalCount":0,
     "limitations":[
       "GNS designated STM named points do not describe full source-to-mouth geometry.",
       "No GNS matches or unavailable queries prove neither nonexistence nor any name conflict.",
       "All-stream searches can reach resultRecordCount limit; record exceededTransferLimit and do not call them exhaustive.",
       "Nearby named rivers at confluences are not proof that all a grouped mainstem has that name.",
       "Official MONRE 2017 Ba Lai termini are river endpoints, NOT Hydro mainstem endpoints.",
       "MLIT Iwabuchi facility is a rainfall gauge on a building roof, NOT a river gauge or centerline.",
     ],
     "items":items
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(outcome,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("OSM_BATCH03_AUDIT="+json.dumps({
        "systems":len(items),"pointsCompared":outcome["comparedIndependentPoints"],
        "queryStates":[{"id":q["systemId"],"kind":q["kind"],"status":q["status"],
            "raw":q.get("rawFeatureCount",0),"unique":q.get("uniqueRiverPointCount",0),
            "limit":q.get("exceededTransferLimit",False),"failureClass":q.get("failureClass")} for q in queried],
        "items":[{"id":row["systemId"],"currentName":row["originalNameKo"],
         "lengthKm":row["mainstemLengthKm"],"pointCount":row["pointCount"],
         "within1km":row["pointCountWithin1km"],"within5km":row["pointCountWithin5km"],
         "nearest":row["independentPointChecks"][:14]} for row in items],
    },ensure_ascii=False,separators=(",",":")),flush=True)

if __name__=="__main__":main()
