#!/usr/bin/env python3
"""Research-only approximate AGPL split of Natural Earth Siachen disputed polygons.

The OSM line is NOT an official agreed or surveyed boundary. These output features
must not silently replace canonical country borders. Requires shapely and pyproj.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
from urllib.request import Request, urlopen

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pyproj import Geod, Transformer
from shapely.geometry import LineString, Point, mapping, shape
from shapely.ops import split, transform, unary_union

OUT = Path("assets/data/research/siachen")
OUT.mkdir(parents=True, exist_ok=True)
OSM_SOURCE_URL = ("https://raw.githubusercontent.com/"
    "uncovering-world/travel-regions-extraction/"
    "7f9129e8cdaa0bd3b4f8b1cd87338c11f037320a/"
    "data/custom-geometries/siachen.geojson")
# Git blob hash for pinned upstream geometry (rather than a mutable branch URL).
OSM_BLOB_SHA1 = "08a49b2b6ac1fa930dfd44c0d6da7d96cb5405b4"
OSM_RELATION = "https://www.openstreetmap.org/relation/13559521"
OSM_SNAPSHOT = "2026-10-04T06:57:51Z"
RGI_ID = "RGI2000-v7.0-G-14-20040"
PROJ = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True)
project = lambda geom: transform(PROJ.transform, geom)
geod = Geod(ellps="WGS84")

def read_feature(name: str):
    v = json.loads((OUT / name).read_text(encoding="utf-8"))
    if v.get("type") != "FeatureCollection" or len(v["features"]) != 1:
        raise ValueError("Expected one GeoJSON feature: " + name)
    return v["features"][0]

def geom_feature(geometry, properties):
    return {"type": "Feature", "properties": properties,
            "geometry": mapping(geometry)}

def save(name: str, features):
    (OUT / name).write_text(json.dumps({"type": "FeatureCollection",
        "features": features}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8")

def get_osm():
    with urlopen(Request(OSM_SOURCE_URL, headers={"User-Agent": "PandoEditor Siachen research"}), timeout=60) as r:
        raw = r.read()
    actual = hashlib.sha1(("blob %d\0" % len(raw)).encode("ascii") + raw).hexdigest()
    if actual != OSM_BLOB_SHA1:
        raise ValueError("OSM upstream GeoJSON blob hash did not match pinned version: " + actual)
    v = json.loads(raw)
    if len(v.get("features", [])) != 1:
        raise ValueError("Expected one OSM feature")
    feat = v["features"][0]
    line = shape(feat["geometry"])
    if line.geom_type != "LineString" or len(line.coords) < 150 or not line.is_simple:
        raise ValueError("Source AGPL candidate is not a simple detailed LineString")
    p = feat["properties"]
    if "relation/13559521" not in p.get("feature_id","") and "13559521" not in p.get("feature_id",""):
        raise ValueError("Wrong upstream OSM relation")
    if "2026-10-04" not in p.get("version_or_date", ""):
        raise ValueError("Wrong OSM snapshot date")
    return line, p, hashlib.sha256(raw).hexdigest()

def verify_geo(g, kind):
    if g.is_empty or not g.is_valid:
        raise ValueError(kind + " empty or topologically invalid")

def polyarea(g):
    return project(g).area / 1e6

def side_of_agpl(line, point):
    """Signed nearest-segment test: source line runs south to north; right = India."""
    position=line.project(point)
    delta=0.00004
    a=line.interpolate(max(0,position-delta))
    b=line.interpolate(min(line.length,position+delta))
    # Directed source line runs south -> north. Right side lies east / India.
    cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x)
    if abs(cross)<1e-12:
        raise ValueError("Cannot classify candidate polygon: signed distance nearly zero")
    return ("IND" if cross < 0 else "PAK",cross)

def split_control(polygon, agpl, rgi_center, scale):
    parts = list(split(polygon, agpl).geoms)
    if len(parts) < 2 or len(parts) > 30:
        raise ValueError(scale + " unexpected number of split polygon components: " + str(len(parts)))
    if agpl.coords[0][1] >= agpl.coords[-1][1]:
        raise ValueError("OSM line direction no longer south to north")
    if side_of_agpl(agpl,rgi_center)[0] != "IND":
        raise ValueError("Physical glacier center is not east of candidate AGPL")
    parts_india,parts_pak=[],[]
    for ix,part in enumerate(parts):
        verify_geo(part, "split part %d" % ix)
        rp=part.representative_point()
        side, signed=side_of_agpl(agpl,rp)
        print("SPLIT PART",scale,ix,"side",side,"area_km2",round(polyarea(part),3),
              "point",[round(rp.x,6),round(rp.y,6)],"cross",round(signed,10),flush=True)
        if side == "IND":
            parts_india.append(part)
        else:
            parts_pak.append(part)
    if not parts_india or not parts_pak:
        raise ValueError("Missing India or Pakistan component after signed split classification")
    # GEOS split() can create near-zero cartographic slivers where the OSM
    # polyline crosses long straight, low-precision Natural Earth edges.
    # Clip source pieces back to the exact disputed area, then classify
    # any sub-km² uncovered fragments explicitly rather than silently losing them.
    raw_india=unary_union(parts_india)
    raw_pakistan=unary_union(parts_pak)
    india=polygon.intersection(raw_india)
    pak_clipped=polygon.intersection(raw_pakistan)
    gap_pre=polygon.difference(unary_union([india,pak_clipped]))
    repair_area=polyarea(gap_pre)
    excessive=1.0
    print("SPLIT GAP BEFORE REPAIR",scale,
          "missing_km2",round(repair_area,6),
          "outside_area_km2",round(polyarea(unary_union([raw_india,raw_pakistan]).difference(polygon)),6),
          flush=True)
    if repair_area > excessive:
        raise ValueError(scale + " missing GEOS split area > 1 km2; manual revision needed")
    patches_india=[]
    patches_pak=[]
    uncovered = list(gap_pre.geoms) if hasattr(gap_pre,"geoms") else [gap_pre]
    for frag in uncovered:
        if frag.is_empty or frag.area < 1e-18:
            continue
        if frag.geom_type != "Polygon":
            raise ValueError("Unexpected split gap fragment type: "+frag.geom_type)
        side,_=side_of_agpl(agpl,frag.representative_point())
        if side=="IND":
            patches_india.append(frag)
        else:
            patches_pak.append(frag)
    if patches_india:
        india=polygon.intersection(unary_union([india]+patches_india))
    # Complement exactly on the Natural Earth dispute geometry.
    pakistan=polygon.difference(india)
    expected_pak=unary_union([pak_clipped]+patches_pak) if patches_pak else pak_clipped
    adjusted_error=polyarea(pakistan.symmetric_difference(expected_pak))
    if adjusted_error > 0.05:
        raise ValueError(scale+" post-repair Pakistan mismatch %.4f km2" % adjusted_error)
    if not india.covers(rgi_center):
        raise ValueError("Glacier center should be within India-designated split")
    for g,label in ((india,"India"),(pakistan,"Pakistan")):
        verify_geo(g,label)
        if polyarea(g)<1:
            raise ValueError(scale+" unexpected tiny area for "+label)
    gap_km2=polyarea(polygon.symmetric_difference(unary_union([india,pakistan])))
    overlap_km2=polyarea(india.intersection(pakistan))
    if gap_km2>0.001 or overlap_km2>0.001:
        raise ValueError(scale+" final conservation failure gap %.6f overlap %.6f" % (gap_km2,overlap_km2))
    print("SPLIT QA",scale,"initial_gap_km2",round(repair_area,6),
          "final_gap_km2",round(gap_km2,8),flush=True)
    return india,pakistan,gap_km2,overlap_km2,repair_area

def paint(ax, geom, facecolor, edgecolor, name=None, width=0.7, alpha=0.8, zorder=1):
    parts = geom.geoms if hasattr(geom, "geoms") else [geom]
    for i,p in enumerate(parts):
        if p.geom_type != "Polygon":
            continue
        xs, ys = zip(*[(c[0],c[1]) for c in p.exterior.coords])
        ax.fill(xs,ys,facecolor=facecolor,edgecolor=edgecolor,linewidth=width,
            alpha=alpha, label=name if i==0 else None, zorder=zorder)
        for hole in p.interiors:
            hx,hy = zip(*[(c[0],c[1]) for c in hole.coords])
            ax.fill(hx,hy,facecolor="white",edgecolor=edgecolor,linewidth=0.3,zorder=zorder+0.1)

def main():
    glacier_f=read_feature("siachen_glacier_rgi7.geojson")
    if glacier_f["properties"].get("rgi_id") != RGI_ID:
        raise ValueError("Unexpected RGI ID")
    glacier=shape(glacier_f["geometry"])
    verify_geo(glacier,"RGI glacier")
    center=glacier.centroid
    line,osmprops,osmsha=get_osm()
    line_m=project(line)
    print("OSM candidate",len(line.coords),"vertices",line_m.length/1000,"km",flush=True)
    print("OSM snapshot",OSM_SNAPSHOT, "source sha256",osmsha,flush=True)
    print("RGI glacier centroid",center.x,center.y,flush=True)
    # Source line extension (~2 km at each end) is inherited from the upstream
    # contributor. This MUST be labelled "approximate" not diplomatic agreement.
    line_props={
        "name":"AGPL (Siachen sector): OpenStreetMap-derived approximate line",
        "name_ko":"사이첸 AGPL(실효지배선) OSM 근사선",
        "feature_type":"approximate_effective_control_line",
        "status":"research_candidate_only",
        "officially_agreed_or_surveyed":False,
        "estimated_accuracy":"undetermined",
        "line_construction":"OSM LoC ways joined; endpoints extended approximately 0.02 degree for clipping by upstream source",
        "osm_relation_url":OSM_RELATION,
        "osm_relation_version":10,
        "osm_snapshot":OSM_SNAPSHOT,
        "derived_line_source_url":OSM_SOURCE_URL,
        "upstream_blob_sha1":OSM_BLOB_SHA1,
        "upstream_source_sha256":osmsha,
        "underlying_osm_ways":"329316222;484308119;1168804850;1536432437",
        "attribution":"© OpenStreetMap contributors; derived line from uncovering-world/travel-regions-extraction",
        "license":"ODbL 1.0",
        "notes":"Does not establish state sovereignty or the precise locations of military posts.",
    }
    # Persist only after all comparisons succeed, not during partial execution.
    reports={}
    exported={}
    splitparts={}
    for scale in ("10m","50m"):
        disputed=read_feature("siachen_dispute_ne_"+scale+".geojson")
        if disputed["properties"].get("feature_type")!="political_disputed_area_not_glacier":
            raise ValueError("Natural Earth political source unexpectedly changed")
        polygon=shape(disputed["geometry"])
        verify_geo(polygon,scale+" disputed area")
        india,pak,gap,overlap,repair_area=split_control(polygon,line,center,scale)
        splitparts[scale]=(india,pak)
        g_in=glacier.intersection(india)
        g_pk=glacier.intersection(pak)
        g_out=glacier.difference(polygon)
        shared=glacier.intersection(line)
        base=polyarea(polygon)
        shares={
            "dispute_area_km2":round(base,3),
            "india_controlled_dispute_km2":round(polyarea(india),3),
            "pakistan_controlled_dispute_km2":round(polyarea(pak),3),
            "india_dispute_share_pct":round(100*polyarea(india)/base,2),
            "pakistan_dispute_share_pct":round(100*polyarea(pak)/base,2),
            "glacier_inside_india_split_km2":round(polyarea(g_in),3),
            "glacier_inside_pakistan_split_km2":round(polyarea(g_pk),3),
            "glacier_outside_ne_dispute_km2":round(polyarea(g_out),3),
            "candidate_line_crosses_glacier_length_km":round(project(shared).length/1000,3),
            "coverage_gap_km2":round(gap,6),
            "splitting_numeric_sliver_repaired_km2":round(repair_area,6),
            "partition_overlap_km2":round(overlap,6),
        }
        reports[scale]=shares
        print(scale,json.dumps(shares,ensure_ascii=False),flush=True)
        common={
            "boundary_basis":"2026-10-04 OSM-derived AGPL approximate candidate",
            "disputed_sovereignty":True,
            "source_dispute_polygon":"Natural Earth "+scale+" B45",
            "line_source_url":OSM_SOURCE_URL,
            "source_osm_relation":OSM_RELATION,
            "license":"ODbL 1.0 (derived geometries); source NE public domain",
            "category":"research-only effective control candidate",
            "not_a_legal_boundary":True,
            "confidence":"cartographic approximation; nonofficial",
            "valid_at":"OSM snapshot 2026-10-04; not historical 1984 boundary",
        }
        exported[scale]=[
            geom_feature(india,{"control":"IND", "name":"Siachen dispute portion — India de facto",**common}),
            geom_feature(pak,{"control":"PAK", "name":"Siachen dispute portion — Pakistan de facto",**common}),
        ]
    # Compare difference in India-mapped parts at 10m / 50m using common extent.
    india10,pak10=splitparts["10m"]
    india50,pak50=splitparts["50m"]
    disagreement=polyarea(india10.symmetric_difference(india50))
    reports["scale_sensitivity"]={
        "india_polygon_symdiff_km2_10m_vs_50m":round(disagreement,3),
        "boundary_candidate_length_km":round(line_m.length/1000,3),
        "source_osm_vertex_count":len(line.coords),
        "source_osm_snapshot":OSM_SNAPSHOT,
        "source_raw_sha256":osmsha,
    }
    if reports["10m"]["glacier_inside_pakistan_split_km2"] > 0.05:
        reports["warning"]="OSM approximate AGPL assigns part of the RGI glacier polygon to the Pakistan side. This is SOURCE DISCREPANCY, NOT evidence that Pakistan occupies Siachen proper; requires manual satellite/toponym interpretation."
    else:
        reports["warning"]="Overlap tests do not establish surveyed or agreed AGPL; manual verification needed."
    print("CROSSCHECK",reports["scale_sensitivity"],reports["warning"],flush=True)
    save("siachen_agpl_osm_candidate.geojson",[geom_feature(line,line_props)])
    for scale in ("10m","50m"):
        save("siachen_control_split_ne_"+scale+".geojson",exported[scale])
    (OUT/"siachen_control_comparison.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    fig,ax=plt.subplots(figsize=(10.5,8.5))
    paint(ax,india10,"#e8b57e","#986537","India-side within NE dispute (OSM estimate)",zorder=2)
    paint(ax,pak10,"#9dc7aa","#447c58","Pakistan-side within NE dispute (OSM estimate)",zorder=2)
    paint(ax,glacier,"#89cdec","#176783","RGI 7.0 glacier outline (2002)",width=.3,alpha=.7,zorder=3)
    lx,ly=zip(*line.coords)
    ax.plot(lx,ly,color="#242424",linewidth=1.0,label="OSM approx. AGPL",zorder=4)
    ax.scatter([center.x],[center.y],marker="+",color="darkblue",s=55,zorder=5,label="RGI glacier centroid")
    ax.set_title("Siachen: OSM approximate AGPL vs actual glacier and disputed polygon")
    ax.set_xlabel("Longitude (E)");ax.set_ylabel("Latitude (N)")
    ax.set_aspect(1/.816);ax.grid(alpha=.2);ax.legend(loc="upper right",fontsize=8)
    fig.tight_layout();fig.savefig(OUT/"siachen_control_comparison.png",dpi=175);plt.close(fig)
    note=("# Siachen AGPL candidate and effective-control split — research only\n\n"
    "Sources: OpenStreetMap relation 13559521 (ODbL 1.0), pinned derivative "
    +OSM_SOURCE_URL+"; observation 2026-10-04T06:57:51Z; "
    "Natural Earth v5.1.2 disputed area, public domain; RGI 7.0, CC BY 4.0.\n\n"
    "**NOT an official demarcated border.** The position of military outposts "
    "is not independently surveyed. Source extends each end of the OSM line "
    "by about 0.02 degrees to cross a separate geography's limits. "
    "It is approximate, unsuited to cadastral/sovereignty determination.\n\n"
    "The OSM line and derived control split are subject to ODbL 1.0 and require "
    "attribution/derivative-database license compliance. Do not merge into a "
    "canonical country database before ODbL integration review.\n\n"
    "The 1984-04-13 Operation Meghdoot date is NOT the geometry date. "
    "Present positions evolved after 1984; this represents 2026 OSM mapping only.\n\n"
    "Files:\n"
    "- siachen_agpl_osm_candidate.geojson: source OSM-derived line (190 vertices)\n"
    "- siachen_control_split_ne_10m.geojson: two polygons clipped to Natural Earth 1:10m B45\n"
    "- siachen_control_split_ne_50m.geojson: corresponding two polygons for Natural Earth 1:50m B45\n"
    "- siachen_control_comparison.json: polygon area-conservation, ice-line conflicts, scale sensitivity\n"
    "- siachen_control_comparison.png: exploratory map.\n\n"
    "The glacier is a **physical ice outline** and separate from political "
    "dispute polygons; RGI geometry is unchanged. Country data are unchanged. "
    "Do not confuse OSM approximate AGPL with legal India/Pakistan border.\n")
    (OUT/"README_control.md").write_text(note,encoding="utf-8")
    print("SUCCESS: AGPL candidate and NE disputed-area partitions QA passed.",flush=True)

if __name__ == "__main__":
    main()
