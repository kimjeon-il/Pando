#!/usr/bin/env python3
"""Independent ridge-continuity and pass-saddle diagnostics, NOT border tracing.

Never modify the existing AGPL / country / glacier geometries. All generated points
are terrain profile observations only, not surveyed passes or troop positions.
"""
from __future__ import annotations
import json
import math
import tempfile
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter1d
from scipy.signal import find_peaks
from shapely.geometry import Point, shape
from shapely.ops import transform
from scripts.research.siachen.compare_cop30_sia_bilafond import (
    OUT, DEM_URL, download, load_raster, raster_heights, TO_UTM, TO_WGS
)

STUDIES={
  "bilafond_north": {"km_min":61.0,"km_max":64.0},
  "mid_ridge_90km": {"km_min":89.4,"km_max":92.2},
  "sia_la": {"km_min":99.0,"km_max":101.4},
}
RANGES=[300,600,900,1200,1500,1800]
STEP_M=30
ALONG_M=125
OFFSET_GRID=np.arange(-1800,1801,STEP_M,dtype=float)
SITES=[
    {"id":"sia_wikipedia","name":"Sia La - Wikipedia","lon":76.79250,"lat":35.58194,"reported_elevation_m":5589},
    {"id":"sia_osm","name":"Sia La - OSM / Mapcarta","lon":76.79081,"lat":35.58123,"reported_elevation_m":5803},
    {"id":"sia_nga","name":"Sia La - Getty/NGA","lon":76.78760,"lat":35.59040,"reported_elevation_m":None},
    {"id":"bilafond_osm","name":"Bilafond La - OSM","lon":76.94873,"lat":35.39186,"reported_elevation_m":5450},
    {"id":"bilafond_nga","name":"Bilafond La - Getty/NGA","lon":76.94860,"lat":35.39220,"reported_elevation_m":None},
]

def load_line():
    f=json.loads((OUT/"siachen_agpl_osm_candidate.geojson").read_text())["features"][0]
    assert f["properties"]["osm_relation_version"]==10
    geom=shape(f["geometry"])
    return transform(TO_UTM.transform,geom)

def sample_normal(line,station,dem,affine):
    p=line.interpolate(station)
    q=line.interpolate(max(0,station-80))
    r=line.interpolate(min(line.length,station+80))
    vx,vy=r.x-q.x,r.y-q.y
    norm=math.hypot(vx,vy)
    if norm<1:raise ValueError("Invalid local tangent")
    nx,ny=vy/norm,-vx/norm  # + is east/right for southern-to-northern line
    xs=p.x+OFFSET_GRID*nx
    ys=p.y+OFFSET_GRID*ny
    zs=raster_heights(xs,ys,dem,affine)
    valid=np.isfinite(zs)
    if valid.mean()<.95:return None
    if not np.all(valid):
        idx=np.arange(len(zs))
        zs=np.interp(idx,idx[valid],zs[valid])
    smooth=gaussian_filter1d(zs,1.5)
    center=np.argmin(abs(OFFSET_GRID))
    origin=float(smooth[center])
    result={"station_km":round(station/1000,4),
            "origin_utm_xy_m":[round(p.x,2),round(p.y,2)],
            "origin_lonlat":[round(v,7) for v in TO_WGS.transform(p.x,p.y)],
            "center_dem_m":round(origin,1)}
    for radius in RANGES:
        subset=np.where(abs(OFFSET_GRID)<=radius)[0]
        imax=subset[np.argmax(smooth[subset])]
        offset=int(OFFSET_GRID[imax])
        result["max_offset_{}".format(radius)]=offset
        result["max_gain_{}".format(radius)]=round(float(smooth[imax])-origin,1)
        result["search_edge_{}".format(radius)]=abs(offset)>=radius-STEP_M
    peaks,props=find_peaks(smooth,prominence=20,distance=4)
    major=sorted(peaks,key=lambda i:smooth[i],reverse=True)[:8]
    result["local_peak_candidates"]=[{
        "offset_m":int(OFFSET_GRID[i]),
        "elevation_m":round(float(smooth[i]),1),
    } for i in major]
    return result,(OFFSET_GRID.copy(),smooth)

def site_saddle(site,dem,affine):
    x,y=TO_UTM.transform(site["lon"],site["lat"])
    z=float(raster_heights([x],[y],dem,affine)[0])
    results={}
    for radius in (120,240,420):
        opts=[]
        for degrees in range(0,180,10):
            a=math.radians(degrees)
            ux,uy=math.cos(a),math.sin(a)
            # Two opposing directions along one axis and its perpendicular.
            xpts=[x+radius*ux,x-radius*ux,x-radius*uy,x+radius*uy]
            ypts=[y+radius*uy,y-radius*uy,y+radius*ux,y-radius*ux]
            zpts=raster_heights(xpts,ypts,dem,affine)
            if not all(math.isfinite(v) for v in zpts):continue
            diffs=zpts-z
            # Is at lower elevation than both ends along one direction,
            # while at higher elevation than both along the cross direction?
            score=min(float(diffs[0]),float(diffs[1]),
                      float(-diffs[2]),float(-diffs[3]))
            opts.append((score,degrees,[round(float(t),1) for t in diffs]))
        if not opts:raise ValueError("No DEM radial saddle samples")
        score,degrees,diffs=max(opts,key=lambda x:x[0])
        results[str(radius)]={"saddle_score_min_quadrant_m":round(score,1),
                               "optimal_axis_degrees_utm":degrees,
                               "radial_height_differences_m":diffs,
                               "saddle_shape_supported":bool(score>5 if radius==120 else score>15)}
    return {"id":site["id"],"name":site["name"],
        "lonlat":[site["lon"],site["lat"]],
        "dem_elevation_m":round(z,1),
        "reported_elevation_m":site["reported_elevation_m"],
        "dem_minus_published_m":round(z-site["reported_elevation_m"],1) if site["reported_elevation_m"] is not None else None,
        "radius_saddle_diagnostic":results,
        "caveat":"Saddle score is local DSM shape only, not a survey or a political border."}

def fig_profiles(profile,label):
    x,z=profile
    fig,ax=plt.subplots(figsize=(10,5))
    ax.plot(x/1000,z,color="#3074a1",lw=1.8)
    ax.axvline(0,color="#cd3142",ls="--",label="OSM approximate AGPL")
    for radius in RANGES[:]:
        ax.axvline(radius/1000,color="#666",alpha=.09)
        ax.axvline(-radius/1000,color="#666",alpha=.09)
    ax.set_xlabel("Distance normal to OSM line (km; positive = east/right)")
    ax.set_ylabel("Copernicus DEM surface elevation (m)")
    ax.set_title(label)
    ax.grid(alpha=.2);ax.legend(fontsize=8)
    fig.tight_layout()
    return fig

def main():
    line=load_line()
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/"dem.tif"
        source=download(DEM_URL,path)
        dem,affine,meta=load_raster(path)
    result={"dataset":"Copernicus DEM GLO-30 Public, UTM43N 30m",
        "dem_source":source,"dem_metadata":meta,
        "agpl":"OSM approximation (2026-10-04), NOT a surveyed military border",
        "analysis":"Cross-section maximum sensitivity (±300–1800m) and local radial terrain saddle test",
        "limitation":"A local elevation maximum is not automatically a watershed and does not imply a military boundary. Glacier surfaces and valley slopes can distort heights.",
        "transect_interval_m":ALONG_M,"studies":{},
        "saddle_site_points":[]}
    features=[]
    for name,win in STUDIES.items():
        lo=int(win["km_min"]*1000)
        hi=int(win["km_max"]*1000)
        stations=np.arange(lo,hi+1,ALONG_M,dtype=float)
        entries=[]
        for st in stations:
            sampled=sample_normal(line,float(st),dem,affine)
            if sampled is None:
                print("INVALID TRANSECT",name,st,flush=True)
                continue
            row,profile=sampled
            entries.append(row)
            if name=="mid_ridge_90km" and 90500<=st<=91000 and st % 250==0:
                fig=fig_profiles(profile,"Saltoro 90 km elevation profile | OSM station {:.3f}km".format(st/1000))
                file="siachen_terrain_90km_profile_{:05d}.png".format(int(st))
                fig.savefig(OUT/file,dpi=180)
                plt.close(fig)
                print("PLOT",file,flush=True)
            if row["max_gain_900"]>=80 or row["search_edge_900"]:
                features.append({"type":"Feature",
                  "geometry":{"type":"Point","coordinates":row["origin_lonlat"]},
                  "properties":{
                    "kind":"dem_cross_profile_diagnostic_not_border",
                    "sector":name,"station_km":row["station_km"],
                    "max_offset_900m":row["max_offset_900"],
                    "max_offset_1800m":row["max_offset_1800"],
                    "gain_900m":row["max_gain_900"],
                    "gain_1800m":row["max_gain_1800"],
                    "search_edge_900m":row["search_edge_900"],
                  }})
        if len(entries)<round(len(stations)*.85):
            raise RuntimeError("Missing too many DEM transect samples in "+name)
        summary={"stations":len(entries),"extent_km":[win["km_min"],win["km_max"]],
                 "counts":{},"samples":entries}
        for radius in RANGES:
            off=np.array([r["max_offset_"+str(radius)] for r in entries])
            gain=np.array([r["max_gain_"+str(radius)] for r in entries])
            bound=np.array([r["search_edge_"+str(radius)] for r in entries],dtype=bool)
            summary["counts"][str(radius)]={
              "median_abs_offset_m":round(float(np.median(abs(off))),1),
              "search_edge_samples":int(bound.sum()),
              "search_edge_pct":round(float(bound.mean()*100),1),
              "high_point_gain_ge100m":int((gain>=100).sum()),
              "pct_positive_east_offset":round(float((off>0).mean()*100),1),
            }
        result["studies"][name]=summary
        print("SUMMARY",name,json.dumps(summary["counts"]),flush=True)
    for site in SITES:
        v=site_saddle(site,dem,affine)
        result["saddle_site_points"].append(v)
        print("PASS",site["id"],json.dumps({"z":v["dem_elevation_m"],
               "120m":v["radius_saddle_diagnostic"]["120"],
               "240m":v["radius_saddle_diagnostic"]["240"]}),flush=True)
    geo={"type":"FeatureCollection","features":features}
    (OUT/"siachen_saltoro_ridge_terrain_diagnostics.geojson").write_text(json.dumps(geo,ensure_ascii=False,indent=2)+"\n")
    (OUT/"siachen_saltoro_ridge_terrain_diagnostics.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    doc=[
      "# Saltoro 90 km and Sia La / Bilafond La DEM geometry sensitivity",
      "Research only, boundary/occupation inference prohibited.",
      "",
      "Copernicus DEM GLO-30 public raster, source and SHA256 in JSON.",
      "Probes repeat ±300m, ±600m, ±900m, ±1200m, ±1500m, ±1800m per profile.",
      "For each window, search_edge=true indicates a height maximum at ±(radius-30m).",
      "Such a maximum may merely be the peak of the search *boundary* rather than a ridge.",
      "Radial saddle score tests opposite uphill/downhill axis directions at 120/240/420m.",
      "It is a heuristic to screen public geographic-name coordinates, NOT pass surveying.",
      "No physical or political GeoJSON source was modified.",
      ""
    ]
    (OUT/"README_saltoro_terrain_continuity.md").write_text("\n".join(doc))
    assert len(result["studies"]["mid_ridge_90km"]["samples"])>15
    assert len(result["saddle_site_points"])==5
    print("SUCCESS terrain continuity / saddle diagnostic",flush=True)

if __name__=="__main__":
    main()
