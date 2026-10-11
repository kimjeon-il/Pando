#!/usr/bin/env python3
"""Source-frozen 2025/2026 Sentinel-2 optical enlargement of Saltoro km90 sector.

Read already approved STAC acquisition IDs and use only their CO(G) B04/B03/B02/SCL.
Output images, georeferenced overlays, metadata — not political boundaries.
"""
from __future__ import annotations
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from shapely.geometry import shape, mapping, Point, LineString
from pyproj import Transformer

import compare_sentinel2_saltoro as base

ROOT=Path("assets/data/research/siachen")
INPUT=ROOT/"siachen_s2_optical_comparison.json"
ANALYSIS=ROOT/"sia_bilafond_dem_comparison.json"
BBOX=[76.725,35.501,76.796,35.548]
TARGET=[90.038,90.288,90.538,90.788,91.038,91.288]

def main():
    data=json.loads(INPUT.read_text(encoding="utf-8"))
    study=json.loads(ANALYSIS.read_text(encoding="utf-8"))
    original=base.features("siachen_agpl_osm_candidate.geojson")[0]
    line=shape(original["geometry"])
    samples=study["terrain_samples"]
    focus=[]
    for t in samples:
        if min(abs(t["station_km"]-v) for v in TARGET)>.001:
            continue
        focus.append(t)
    if len(focus)!=len(TARGET):
        raise RuntimeError("Missing DEM transect station in previous report")
    source_points=[]
    for t in focus:
        source_points.append({"type":"Feature","geometry":{"type":"Point","coordinates":[t["lon"],t["lat"]]},
                              "properties":{"type":"OSM_line_station","station_km":t["station_km"],
                                "elevation_dem_m":t["dem_elevation_at_osm_m"]}})
        source_points.append({"type":"Feature","geometry":{"type":"Point","coordinates":[t["local_max_lon"],t["local_max_lat"]]},
                              "properties":{"type":"DEM_local_transect_high_point_not_surveyed_ridge",
                                "station_km":t["station_km"],"offset_right_east_m":t["local_max_offset_right_east_m"],
                                "elevation_advantage_m":t["local_max_advantage_m"],
                                "window_boundary_warning":abs(t["local_max_offset_right_east_m"])>=880}})
    report={"analysis":"Existing AGPL km90 sector; 2025 and 2026 Sentinel-2 optical crosscheck",
            "status":"research_only_candidate_not_legally_verified",
            "source_line":"OSM relation 13559521 pinned 2026-10-04; ODbL 1.0",
            "inputs":{
                "stac_metadata":"siachen_s2_optical_comparison.json",
                "dem_samples":"sia_bilafond_dem_comparison.json",
                "DEM_Copernicus":"GLO-30 2011-2015 observation (30m resample)",
                "optical":"Copernicus Sentinel-2 L2A 10m",
            },
            "area_bbox_wgs84":BBOX,
            "anomaly":{"stations":focus,
                       "maximum_search_boundary_note":"The +890m local maximum is at the original ±900m peak-search limit, not a measured crest position; revisit with a wider cross-section."},
            "years":{},
    }
    figures={}
    for year in ("2025","2026"):
        old=data["scenes"][year]
        item={"id":old["item_id"],"assets":{key:{"href":value} for key,value in old["assets"].items()},
              "properties":{"datetime":old["datetime"]}}
        rgb,extent,quality=base.rgb_crop(item,BBOX)
        fig,ax=plt.subplots(figsize=(9,8.8))
        ax.imshow(rgb,origin="upper",extent=extent)
        lo=list(line.coords)
        x,y=base.TF.transform([p[0] for p in lo],[p[1] for p in lo])
        ax.plot(x,y,color="#ff3157",linewidth=1.7,label="OSM AGPL approx (not surveyed)")
        for t in focus:
            axX,axY=base.TF.transform(t["lon"],t["lat"])
            pkX,pkY=base.TF.transform(t["local_max_lon"],t["local_max_lat"])
            ax.plot([axX,pkX],[axY,pkY],color="#f9e400",linestyle=":",lw=1.3,alpha=.9)
            ax.scatter([axX],[axY],c="#ef2047",s=36,edgecolors="#fff",linewidths=.4,zorder=8)
            ax.scatter([pkX],[pkY],marker="^",s=52,c="#fff548",edgecolors="#181818",linewidths=.8,zorder=9)
            if t["station_km"] in (90.538,90.788,91.038):
                ax.annotate("%.3fkm" % t["station_km"],(axX,axY),xytext=(7,-13),textcoords="offset points",
                            color="white",fontsize=8,bbox={"facecolor":"#242424","alpha":.65,"pad":1.4})
        ax.set_xlim(extent[0],extent[1]);ax.set_ylim(extent[2],extent[3]);ax.set_aspect("equal")
        ax.set_title("Saltoro km90.5 ridge anomaly | "+year+" Sentinel-2 L2A\n"+old["datetime"][:10]+
                     "  Red: OSM / Yellow: DEM local 900m-window peak",fontsize=10)
        ax.set_xlabel("UTM zone 43N easting (m)");ax.set_ylabel("UTM zone 43N northing (m)")
        ax.legend(loc="lower left",fontsize=8,framealpha=.75)
        fig.text(.5,.012,"© Copernicus Sentinel data / OSM contributors (ODbL); peak positions from Copernicus GLO-30, not verified crest",ha="center",fontsize=7)
        fig.tight_layout(rect=(0,.024,1,1))
        name="siachen_s2_"+year+"_km90_corridor.png"
        fig.savefig(ROOT/name,dpi=155);plt.close(fig)
        report["years"][year]={"item_id":old["item_id"],"datetime":old["datetime"],
            "manifest_source_scene":old["item_id"],"asset_urls":old["assets"],
            "local_optical_quality":quality,"overlay_image":name}
        print("SENTINEL KM90",year,old["item_id"],name,quality,flush=True)
    (ROOT/"siachen_s2_km90_corridor.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    (ROOT/"siachen_s2_km90_corridor.geojson").write_text(json.dumps(
        {"type":"FeatureCollection","features":source_points},ensure_ascii=False,separators=(",",":"))+"\n",encoding="utf-8")
    (ROOT/"README_s2_km90.md").write_text(
        "# km90 Saltoro optical review\n\n"+
        "2025/2026 Sentinel-2 L2A, acquisitions pinned in siachen_s2_optical_comparison.json. "+
        "OSM line is a non-surveyed approximation. Original DEM peaks capped to ±900m "+
        "should NOT be treated as actual ridge positions. Satellite scenes are snow covered "+
        "and do not establish field troop locations, control, or internationally agreed borders.\n\n"+
        "Output: 2025+2026 georeferenced PNG crops, input-source JSON, 6-station GeoJSON points.\n"+
        "Licensing: © Copernicus Sentinel data; © OpenStreetMap contributors (ODbL); © ESA/Airbus Copernicus GLO-30.\n"+
        "No existing political/ice/control polygon was changed.\n",encoding="utf-8")
    assert all((ROOT/record["overlay_image"]).stat().st_size>30000 for record in report["years"].values())
    print("SUCCESS km90 independent satellite date comparison",flush=True)

if __name__=="__main__":
    main()
