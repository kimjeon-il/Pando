#!/usr/bin/env python3
"""Diagnose apparent Pakistan-side Siachen glacier slivers using pinned RGI7+OSM+NE.

No new geopolitical boundary is created; all comparisons are source-specific.
"""
import json
from pathlib import Path
from shapely.geometry import shape, mapping, Polygon, LineString, Point
from shapely.ops import transform
from pyproj import Transformer
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT=Path("assets/data/research/siachen")
FILE_G="siachen_glacier_rgi7.geojson"
FILE_L="siachen_agpl_osm_candidate.geojson"
FILE_P="siachen_control_split_ne_10m.geojson"
RGI="RGI2000-v7.0-G-14-20040"
TX=Transformer.from_crs("EPSG:4326","EPSG:32643",always_xy=True)
area=lambda g:transform(TX.transform,g).area/1e6
length=lambda g:transform(TX.transform,g).length/1000

def read(path):
    x=json.loads((OUT/path).read_text(encoding="utf-8"))
    assert x["type"]=="FeatureCollection"
    return x["features"]

def geom(g,props):
    return {"type":"Feature","properties":props,"geometry":mapping(g)}

def components(g):
    if g.is_empty:return []
    if g.geom_type=="Polygon":return [g]
    if g.geom_type=="MultiPolygon":return list(g.geoms)
    if g.geom_type=="GeometryCollection":
        return [p for x in g.geoms for p in components(x)]
    return []

def lines(g):
    if g.is_empty:return []
    if g.geom_type=="LineString":return [g]
    if g.geom_type=="MultiLineString":return list(g.geoms)
    if g.geom_type=="GeometryCollection":
        return [p for x in g.geoms for p in lines(x)]
    return []

def round_box(g):
    return [round(v,6) for v in g.bounds]

def info(g):
    c=g.representative_point()
    cen=g.centroid
    return {"area_km2":round(area(g),6),"bounds_lonlat":round_box(g),
            "representative_point_lonlat":[round(c.x,7),round(c.y,7)],
            "centroid_lonlat":[round(cen.x,7),round(cen.y,7)],
            "length_perimeter_km":round(length(g.boundary),3),
            "vertex_count":sum(len(p.exterior.coords) for p in components(g))}

def paint(ax,g,color,label,linewidth=1.5,fill=False,alpha=.75):
    for i,p in enumerate(components(g)):
        x,y=zip(*[(v[0],v[1]) for v in p.exterior.coords])
        if fill:
            ax.fill(x,y,facecolor=color,edgecolor=color,lw=linewidth*.2,alpha=alpha,label=label if i==0 else None)
        else:
            ax.plot(x,y,color=color,linewidth=linewidth,alpha=alpha,label=label if i==0 else None)
        for hole in p.interiors:
            hh=list(hole.coords)
            ax.plot([v[0] for v in hh],[v[1] for v in hh],color=color,lw=.5)

def main():
    gl=read(FILE_G)[0]
    assert gl["properties"]["rgi_id"]==RGI
    glacier=shape(gl["geometry"])
    agpl_f=read(FILE_L)[0]
    agpl=shape(agpl_f["geometry"])
    assert len(agpl.coords)==190
    report={
       "input": {
           "RGI_id":RGI,
           "rgi_image_date":gl["properties"]["RGI_attrs"].get("src_date"),
           "osm_relation":agpl_f["properties"].get("osm_relation_url"),
           "osm_snapshot":agpl_f["properties"].get("osm_snapshot"),
           "glacier_area_km2":round(area(glacier),3),
           "glacier_bounds":round_box(glacier),
           "AGPL_length_km":round(length(agpl),3),
           "glacier_polygon_valid":glacier.is_valid,
           "agpl_simple":agpl.is_simple,
       },
       "by_source_scale":{},
       "warning":[],
    }
    discrepancy={}
    export=[geom(agpl,{"kind":"AGPL candidate, not officially surveyed","source":"OSM 2026-10-04"}),
            geom(glacier,{"kind":"Physical RGI 7.0 glacier","source_image_date":"2002-07-10"})]
    for scale in ("10m","50m"):
        matches={f["properties"]["control"]:shape(f["geometry"]) for f in read("siachen_control_split_ne_"+scale+".geojson")}
        ind,pak=matches["IND"],matches["PAK"]
        inv=glacier.intersection(ind)
        pkv=glacier.intersection(pak)
        outside=glacier.difference(ind.union(pak))
        comps=sorted(components(pkv),key=lambda x:area(x),reverse=True)
        discrepancy[scale]=pkv
        out={
            "rgi_overlap_india_km2":round(area(inv),6),
            "rgi_overlap_pakistan_km2":round(area(pkv),6),
            "rgi_outside_ne_dispute_km2":round(area(outside),6),
            "rgi_pakistan_count":len(comps),
            "rgi_pakistan_components":[dict(index=i+1,**info(p)) for i,p in enumerate(comps)],
            "rgi_pakistan_total_component_km2":round(sum(area(p) for p in comps),6),
        }
        report["by_source_scale"][scale]=out
        print("SCALE",scale,"PK",round(area(pkv),6),"count",len(comps),"major",[x["area_km2"] for x in out["rgi_pakistan_components"][:8]],flush=True)
        for i,p in enumerate(comps):
            export.append(geom(p,{"kind":"RGI ice portion outside nominal India side, *source conflict only*","scale":scale,"component":i+1,**info(p),"not_evidence_of_pakistan_occupation":True}))
        if abs(sum(area(p) for p in comps)-area(pkv))>1e-4:
            raise RuntimeError("Component area total mismatch")

    # The Natural Earth B45 area is not the full glacier; assess the line
    # independently of the artificial NE clipping wedge.
    top=agpl.coords[-1][1]
    bottom=agpl.coords[0][1]
    boxright=79.0
    boxleft=75.0
    east=Polygon(list(agpl.coords)+[(boxright,top),(boxright,bottom)])
    west=Polygon(list(agpl.coords)+[(boxleft,top),(boxleft,bottom)])
    report["uncut_glacier_vs_agpl"]={
        "east_side_mask_valid":east.is_valid,
        "west_side_mask_valid":west.is_valid,
        "mask_scope_lat":[bottom,top],
    }
    if east.is_valid and west.is_valid:
        iceeast=glacier.intersection(east)
        icewest=glacier.intersection(west)
        report["uncut_glacier_vs_agpl"].update({
            "east_ice_area_km2":round(area(iceeast),6),
            "west_ice_area_km2":round(area(icewest),6),
            "east_west_ice_area_sum_km2":round(area(iceeast)+area(icewest),6),
            "west_ice_components":[dict(index=i+1,**info(p)) for i,p in enumerate(sorted(components(icewest),key=lambda p:area(p),reverse=True))],
        })
        export += [geom(p,{"kind":"RGI ice west of OSM AGPL, independent of NE B45","component":i+1,"not_evidence_of_pakistan_occupation":True,**info(p)}) for i,p in enumerate(sorted(components(icewest),key=lambda p:area(p),reverse=True))]
        print("WEST_ALL",round(area(icewest),6),"EAST_ALL",round(area(iceeast),6),flush=True)
    else:
        report["warning"].append("AGPL-based east/west mask invalid; entire-glacier side measurement skipped")

    intersect=glacier.intersection(agpl)
    ss=sorted(lines(intersect),key=lambda x:length(x),reverse=True)
    report["line_through_ice"]={
        "intersected_length_km":round(length(intersect),6),
        "line_segments_count":len(ss),
        "major_segments":[{
             "length_km":round(length(g),5),"bounds_lonlat":round_box(g),
             "midpoint_lonlat":[round(g.interpolate(.5,normalized=True).x,7),
                                 round(g.interpolate(.5,normalized=True).y,7)]
        } for g in ss[:30]],
    }
    print("AGPL_INTERSECT_RGI",report["line_through_ice"],flush=True)

    # Independent reported landmark coordinates. Sources are not surveyed military
    # positions, and alternate names/coordinate versions can disagree.
    landmarks=[
        dict(name="Sia La",ref="OSM via Mapcarta",lon=76.79081,lat=35.58123,source="https://mapcarta.com/14675508",reported_control="IND"),
        dict(name="Sia La",ref="NGA via Getty TGN",lon=76.7876,lat=35.5904,source="https://www.getty.edu/vow/TGNFullDisplay?subjectid=7923170",reported_control="IND"),
        dict(name="Bilafond La",ref="OSM via Mapcarta",lon=76.94873,lat=35.39186,source="https://mapcarta.com/14710602",reported_control="IND"),
        dict(name="Bilafond La",ref="NGA via Getty TGN",lon=76.9486,lat=35.3922,source="https://www.getty.edu/vow/TGNFullDisplay?subjectid=7902300",reported_control="IND"),
        dict(name="Gyong La",ref="OSM via Mapcarta",lon=77.07021,lat=35.17441,source="https://mapcarta.com/14700516",reported_control="IND"),
        dict(name="K12",ref="OSM via Mapcarta",lon=77.0219,lat=35.2955,source="https://mapcarta.com/N4770525720",reported_control="IND"),
    ]
    metric_agpl=transform(TX.transform,agpl)
    landmark_results=[]
    for q in landmarks:
        pt=Point(q["lon"],q["lat"])
        mpt=transform(TX.transform,pt)
        chainage=metric_agpl.project(mpt)
        close=metric_agpl.interpolate(chainage)
        aa=metric_agpl.interpolate(max(0,chainage-20))
        bb=metric_agpl.interpolate(min(metric_agpl.length,chainage+20))
        sign=(bb.x-aa.x)*(mpt.y-aa.y)-(bb.y-aa.y)*(mpt.x-aa.x)
        side="IND" if sign<0 else "PAK"
        entry={**q,"distance_to_osm_candidate_m":round(mpt.distance(metric_agpl),2),
               "which_side_of_candidate":side,
               "side_consistent_with_reported_control":side==q["reported_control"],
               "chainage_from_south_km":round(chainage/1000,3)}
        landmark_results.append(entry)
        print("LANDMARK",q["name"],q["ref"],"distance_m",entry["distance_to_osm_candidate_m"],
              "OSM-side",side,"reported-control",q["reported_control"],flush=True)
    report["landmark_sanity_check"]={
        "control_reference":"CNES reports the three major passes held by India. K12's military position is more complex; coordinates locate terrain features rather than outposts.",
        "line_source":"OpenStreetMap 2026-10-04 approximation, independent of reported landmark coordinates where available",
        "landmarks":landmark_results,
        "nominal_india_landmarks_plotted_on_pakistan_side":sum(not x["side_consistent_with_reported_control"] for x in landmark_results),
        "note":"Point accuracy and map labels vary: results within tens to hundreds of metres are diagnostics, not surveyed AGPL corrections. No claim of precise post locations.",
    }

    # Produce reproducible overview and per-piece details.
    fig,ax=plt.subplots(figsize=(11,11))
    paint(ax,glacier,"#42a7c9","RGI Siachen outline",.5,True,.18)
    paint(ax,glacier,"#3882a0",None,.4,False,.7)
    paint(ax,discrepancy["10m"],"crimson","RGI ∩ OSM Pakistan-side ∩ NE disputed",1.2,True,.85)
    xx,yy=zip(*agpl.coords)
    ax.plot(xx,yy,color="#222222",lw=1.1,label="OSM approximate AGPL",zorder=7)
    for c in report["by_source_scale"]["10m"]["rgi_pakistan_components"][:20]:
        x,y=c["centroid_lonlat"]
        ax.text(x,y,str(c["index"]),fontsize=9,ha="center",va="center",color="#530000",zorder=10)
    ax.set_title("Siachen 2002 RGI vs OSM-derived AGPL: discrepancy localisation")
    ax.set_xlabel("Longitude (degrees E)");ax.set_ylabel("Latitude (degrees N)")
    ax.grid(alpha=.25);ax.set_aspect(1/.82);ax.legend(fontsize=8,loc="best")
    fig.tight_layout();fig.savefig(OUT/"siachen_agpl_discrepancy_overview.png",dpi=210);plt.close(fig)

    bounds=discrepancy["10m"].bounds
    margin=0.018
    fig,ax=plt.subplots(figsize=(12,9))
    paint(ax,glacier,"#76bfd8","RGI glacier outline",.4,True,.15)
    paint(ax,glacier,"#3984a1",None,.5,False,.5)
    paint(ax,discrepancy["10m"],"red","1:10m RGI ice / Pakistan-side overlap",.7,True,.85)
    ax.plot(xx,yy,color="#333333",lw=1.2,label="OSM candidate AGPL")
    ax.set_xlim(bounds[0]-margin,bounds[2]+margin)
    ax.set_ylim(bounds[1]-margin,bounds[3]+margin)
    ax.set_title("Zoom: glacier / OSM candidate-source discrepancy extent")
    ax.grid(alpha=.2);ax.set_aspect(1/.82);ax.legend(fontsize=8)
    fig.tight_layout();fig.savefig(OUT/"siachen_agpl_discrepancy_zoom.png",dpi=250);plt.close(fig)

    output="siachen_glacier_agpl_discrepancy.geojson"
    (OUT/output).write_text(json.dumps({"type":"FeatureCollection","features":export},ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    (OUT/"siachen_agpl_discrepancy_diagnostic.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    txt="""# RGI versus OSM AGPL discrepancy diagnostic

This is a diagnostic of **source discrepancies**, not evidence of Pakistani troops on the glacier.
The AGPL is a cartographic line derived from OpenStreetMap, not a surveyed or bilateral line.
The RGI shape is the extent of ice observed in July 2002, not an international border.

Input: RGI2000-v7.0-G-14-20040, OSM relation 13559521 (2026-10-04),
Natural Earth disputed-area 1:10m and 1:50m.

Outputs: discrepancy diagnostic JSON, GeoJSON of disputed portions, detailed overview
and close-up images. In addition to RGI overlap within Natural Earth's schematic
dispute wedge, an independent east/west line mask evaluates glacier ice *outside*
that wedge. Never conflate these quantities.

Landmark QA includes Sia La, Bilafond La, Gyong La and K12 public coordinates; several reported India-held features fall to the west of the OSM line. This implies a cartographic accuracy/position warning, not evidence of Pakistan holding these passes. No military post coordinates are inferred.\n\nNo geometry is changed by this analysis.
"""
    (OUT/"README_discrepancy.md").write_text(txt,encoding="utf-8")
    print("DIAGNOSTIC SUCCESS",flush=True)

if __name__=="__main__":
    main()
