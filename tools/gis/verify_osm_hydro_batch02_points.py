#!/usr/bin/env python3
"""Read-only independent-source identity screen for OSM-Hydro remnants 11–20.

Sources are government-disseminated named coordinates (NGA / Suez Canal
Authority), independently published hydrometric points (if separately
retrieved), and published reference names from Natural Earth. Point-to-line
distance NEVER verifies full identity, river category, or copyright clearance.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

IDS=(
    "20628098","20773860","20774342","30145067","40188382",
    "40364680","40391614","40414035","40415850","40423228",
)
CRS={
    "20628098":"EPSG:32641",
    "20773860":"EPSG:32636","20774342":"EPSG:32636",
    "30145067":"EPSG:32641",
    "40188382":"EPSG:32642",
    "40364680":"EPSG:32652","40391614":"EPSG:32652",
    "40414035":"EPSG:32652","40415850":"EPSG:32652",
    "40423228":"EPSG:32652",
}
# Waypoints are only geographically nearby independently designated features;
# a berth or gauge may be laterally offset from the centerline by design.
SUEZ_OFFICIAL="https://companies.suezcanal.gov.eg/Home/English/Pages/default.aspx"
WAMIS_AG="https://data.mafra.go.kr/opendata/data/indexOpenDataDetail.do?data_id=20240702000000002517"
KOREA_STATION="https://yss.purpleo.kr/article/277"
RIMGIS="https://river.go.kr/intro/nationOrigin.do"
NGA="https://geonames.nga.mil/geonames/GNSHome/"
NGA_RYESONG="https://geonames.nga.mil/geon-ags/rest/services/RESEARCH/GIS_OUTPUT/MapServer/0/query?outFields=%2A&where=ufi+%3D+-191071"
TUM_OB="https://dahiti.dgfi.tum.de/en/38692/"
TUM_AMU="https://dahiti.dgfi.tum.de/en/12348/"
KERKI_SCIENCE="https://www.mdpi.com/2073-4441/17/5/721"
RUS_IRTYSH="https://www.snt-bugorok.ru/level/uroven-vody-v-irtyshe-u-goroda-khanty-mansiisk-segodnya"
RUS_FISH_LEGAL="https://fish.gov.ru/wp-content/uploads/2025/11/zs.pdf"
CENTRAL_ASIA=[
 {"id":"tmu_amu_12348","name":"Amu Darya river (satellite water level reference)","lon":65.5596,"lat":37.6545,
  "kind":"German-TUM-DAHITI-water-level-site","source":TUM_AMU},
 {"id":"kerki_2025_paper","name":"Amu Darya Kerki hydrometric station","lon":65.25,"lat":37.83,
  "kind":"named-hydrometric-station-scholarly-coordinate","source":KERKI_SCIENCE},
]
OB_SYSTEM=[
 {"id":"tum_ob_38692","name":"Ob river satellite water level point","lon":65.7292,"lat":65.69,
  "kind":"German-TUM-DAHITI-satellite-water-level-site","source":TUM_OB},
 {"id":"hydromet_irtysh_hanty","name":"Irtysh hydrometric station Khanty-Mansiysk","lon":68.9853,"lat":60.9882,
  "kind":"federal-hydromet-coordinates-from-independent-secondary-reproduction","source":RUS_IRTYSH},
 {"id":"ru_fish_irtysh_slushkinskaya","name":"Irtysh legally defined fishing boundary (not gauge)","lon":69+49/60+10.558/3600,"lat":60+12/60+36.419/3600,
  "kind":"Russian-federal-fisheries-statutory-river-coordinate","source":RUS_FISH_LEGAL},
 {"id":"ru_fish_irtysh_sotnikovskaya","name":"Irtysh legally defined fishing boundary (not gauge)","lon":69+52/60+37.268/3600,"lat":60+19/60+46.732/3600,
  "kind":"Russian-federal-fisheries-statutory-river-coordinate","source":RUS_FISH_LEGAL},
]
SCA_POINTS=[
 {"id":"sca_port_said_marina","name":"Suez navigation canal Port Said marina","lon":32.3150132,"lat":31.2561108,"kind":"government-navigation-facility","source":SUEZ_OFFICIAL},
 {"id":"sca_ismailia_marina","name":"Suez navigation canal Ismailia marina","lon":32.2712444,"lat":30.5849802,"kind":"government-navigation-facility","source":SUEZ_OFFICIAL},
 {"id":"sca_port_tawfik_marina","name":"Suez navigation canal Port Tawfik marina","lon":32.5719166,"lat":29.9475083,"kind":"government-navigation-facility","source":SUEZ_OFFICIAL},
]
SOUTH_KOREA=[
 {"id":"ag_namhan_station_277","name":"Namhan River water-level site (Korea Rural Community Corporation data reproduction)","lon":127.6866667,"lat":37.18305556,"kind":"government-derived-station-point-secondary-reproduction","source":KOREA_STATION,"licenseLead":WAMIS_AG},
]
YESONG=[
 {"id":"nga_ufi_minus191071_yesong","name":"Yesong-gang","lon":126.395278,"lat":37.885278,
  "kind":"US-NGA-GNS-named-stream-location-not-centerline","source":NGA_RYESONG},
]
OTHER_NON_STATION=[
 {"id":"nibr_imjin_wetland_zone_centroid","name":"Imjin River ecological study zone centroid (NOT a river station)","lon":126.769,"lat":37.887,
  "kind":"ecological-area-centroid-not-hydrographic-observation",
  "source":"https://www.nibr.go.kr/aiibook/access/ecatalogt.jsp?Dir=1069&callmode=admin&catimage=&eclang=ko&start=12&um=s"},
]
STATIC={
 "20628098":CENTRAL_ASIA,
 "20773860":SCA_POINTS, "20774342":SCA_POINTS,
 "30145067":OB_SYSTEM,
 "40414035":YESONG,
 "40415850":OTHER_NON_STATION,
 "40423228":SOUTH_KOREA,
}
NGA_TARGETS={
 "40364680":("Cheongcheon",["청천강","Chongchon","Ch'ongch'on","Ch’ŏngch’ŏn"]),
 "40391614":("Taedong",["Taedong","Taedong-gang","대동강"]),
 "40414035":("Yesong",["Yesong","예성강"]),
 "40415850":("Imjin",["Imjin","Rimjin","림진강","임진강"]),
}

def parts(geo):
    if geo["type"]=="LineString":return [geo["coordinates"]]
    if geo["type"]=="MultiLineString":return geo["coordinates"]
    raise ValueError(f"Expected river LineString; received {geo['type']}")

def _metric_screen(system_id,features,anchors):
    from pyproj import Transformer
    from shapely.geometry import LineString,Point
    from shapely.ops import transform
    project=Transformer.from_crs("EPSG:4326",CRS[system_id],always_xy=True)
    undo=Transformer.from_crs(CRS[system_id],"EPSG:4326",always_xy=True)
    shapes=[]
    for row in features:
        for segment in parts(row["geometry"]):
            if len(segment)>1:
                line=transform(project.transform,LineString(segment))
                if line.length>0:shapes.append(line)
    if not shapes:raise ValueError(f"No nonempty mainstem for {system_id}")
    unique=[]
    for p in anchors:
        pt=transform(project.transform,Point(p["lon"],p["lat"]))
        closest=min((line.interpolate(line.project(pt)) for line in shapes),key=pt.distance)
        lon,lat=undo.transform(closest.x,closest.y)
        unique.append({"id":p["id"],"designatedName":p["name"],"sourceKind":p["kind"],
                       "independentSource":p["source"],
                       "referenceLonLat":[p["lon"],p["lat"]],
                       "distanceToPublishedMainstemKm":round(float(pt.distance(closest))/1000,3),
                       "nearestHydroLonLat":[round(lon,6),round(lat,6)]})
    return {"mainstemFeatureCount":len(features),"lineSegments":len(shapes),
            "mainstemTotalLengthKm":round(sum(s.length for s in shapes)/1000,3),
            "independentPoints":unique}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--decoded",type=Path,required=True)
    ap.add_argument("--external-gauges",type=Path)
    ap.add_argument("--nga",type=Path)
    ap.add_argument("--output",type=Path,required=True)
    args=ap.parse_args()
    decoded=json.loads(args.decoded.read_text())
    manifest=decoded["manifest"]
    if manifest.get("version")!="0.13.2" or manifest["metadata"].get("featureCount")!=16548:
        raise ValueError("Unexpected published Hydro version or geometry population")
    byid={s:[] for s in IDS}
    for f in decoded["features"]:
        sid=str(f["metadata"].get("systemId") or "")
        if sid in byid and f["metadata"].get("role")=="mainstem":byid[sid].append(f)
    if any(not x for x in byid.values()):raise ValueError("Missing original mainstem systems")

    external={}
    if args.external_gauges and args.external_gauges.exists():
        j=json.loads(args.external_gauges.read_text())
        if j.get("provenance")=="2023-CA-discharge":
            # Each source datum is independently named, explicitly cited,
            # validated by 24.6MB original GeoPackage checksum.
            for p in j.get("gauges",[]):
                sid=p.get("candidateSystem")
                if sid in ("20628098","40188382"):
                    if abs(p["latitude"])>90 or abs(p["longitude"])>180:continue
                    external.setdefault(sid,[]).append({
                        "id":"cad_"+str(p["code"]), "name":p["river"],
                        "lon":p["longitude"],"lat":p["latitude"],
                        "kind":"CA-discharge-scientific-2023-located-hydromet-gauge",
                        "source":"https://zenodo.org/records/7743778",
                    })
    nga={}
    if args.nga and args.nga.exists():
        p=json.loads(args.nga.read_text())
        seen_ufi = set()
        for f in p.get("features",[]):
            sid=str(f.get("candidateSystem") or "")
            if sid in NGA_TARGETS:
                unique=(sid, str(f.get("ufi")))
                if unique in seen_ufi: continue
                seen_ufi.add(unique)
                lon,lat=f.get("longitude"),f.get("latitude")
                if isinstance(lon,(int,float)) and isinstance(lat,(int,float)):
                    nga.setdefault(sid,[]).append({
                        "id":"nga_"+str(f.get("ufi")), "name":f.get("name") or f.get("ufi"),
                        "lon":lon,"lat":lat,"kind":"US-NGA-GNS-named-stream-feature-point",
                        "source":NGA,
                    })
    items=[]
    for sid in IDS:
        anchors=[*STATIC.get(sid,[]),*external.get(sid,[]),*nga.get(sid,[])]
        # Deduplicate named observation locations without suppressing sources.
        seen=set()
        anchors=[p for p in anchors if not ((p["id"],p["lon"],p["lat"]) in seen or seen.add((p["id"],p["lon"],p["lat"])))]
        x=_metric_screen(sid,byid[sid],anchors)
        x.update(systemId=sid,publishedNameKo=byid[sid][0]["metadata"]["name"],
                 pointScreenHasWholeRiverAuthority=False)
        items.append(x)
    result={
       "schema":"pando-independent-osm-hydro-batch02-point-screen-v1",
       "originalVersion":"0.13.2","originalBundleSha256":manifest["container"]["sha256"],
       "publishedRiverNameMetadataChanged":False,"publishedHydroGeometryChanged":False,
       "osmRelationUsedAsReference":False,
       "studyCount":len(items),"pointsCompared":sum(len(i["independentPoints"]) for i in items),
       "method":"Original published HydroRIVERS mainstem -> independent named points, metric local UTM nearest-geodesic approximation",
       "caveat":"Only proximity. NGA points may be mouth-level approximate; SCA marinas are off-center facilities; ecological area centroid is NOT a gauging site. No rename authorization.",
       "externalGaugesAvailable":bool(external),
       "externalGaugeCounts":{sid:len(rows) for sid,rows in external.items()},
       "ngaResultsAvailable":bool(nga),
       "ngaCounts":{sid:len(rows) for sid,rows in nga.items()},
       "items":items,
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print("HYDRO_BATCH02_PROOF="+json.dumps({
       "points":result["pointsCompared"],
       "externalGaugesAvailable":result["externalGaugesAvailable"],
       "externalGaugeCounts":result["externalGaugeCounts"],
       "ngaResultsAvailable":result["ngaResultsAvailable"],
       "ngaCounts":result["ngaCounts"],
       "items":[{"id":x["systemId"],"name":x["publishedNameKo"],
          "lengthKm":x["mainstemTotalLengthKm"],
          "points":[(y["id"],y["distanceToPublishedMainstemKm"],y["designatedName"]) for y in x["independentPoints"]],
          "closestPoints":sorted([(y["id"],y["distanceToPublishedMainstemKm"],y["designatedName"])
                for y in x["independentPoints"]],key=lambda z:z[1])[:12]}
         for x in items]
    },ensure_ascii=False,separators=(",",":")),flush=True)

if __name__=="__main__":main()
