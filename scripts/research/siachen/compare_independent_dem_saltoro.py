#!/usr/bin/env python3
"""Compare independent topographic models at Saltoro research-only line.
The perpendicular highest elevation is a diagnostic, NOT a crest or state border.
"""
from __future__ import annotations
import hashlib, json, math, tempfile
from pathlib import Path
import numpy as np
import requests
import rasterio
from rasterio.warp import reproject
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform
from scipy.ndimage import map_coordinates, gaussian_filter1d
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT=Path("assets/data/research/siachen")
OUT.mkdir(parents=True,exist_ok=True)
BBOX=(76.715,35.365,76.995,35.610)
CRS="EPSG:32643"
TO_UTM=Transformer.from_crs("EPSG:4326",CRS,always_xy=True)
TO_GEO=Transformer.from_crs(CRS,"EPSG:4326",always_xy=True)
SOURCES={
"COP30":("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N35_00_E076_00_DEM/Copernicus_DSM_COG_10_N35_00_E076_00_DEM.tif","Copernicus GLO30 TanDEM-X radar, 2011-2015"),
"ALOS":("https://opentopography.s3.sdsc.edu/raster/AW3D30/AW3D30_global/ALPSMLC30_N035E076_DSM.tif","JAXA ALOS AW3D30 optical stereo, with possible gap filling"),
"SRTM":("https://opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/N35E076.tif","NASA SRTMGL1 radar (2000)"),
"NASADEM":("https://opentopography.s3.sdsc.edu/raster/NASADEM/NASADEM_be/NASADEM_HGT_n35e076.tif","NASA SRTM-derived void-filled terrain, NOT independent of SRTMGL1")}
STATIONS={"bilafond_north":62.538,"before_shift":90.288,"shift_a":90.538,
          "shift_b":90.788,"after_shift":91.038,"sia_la":100.405}
LANDMARKS={"sia_wikipedia":[76.79250,35.58194],
           "sia_osm":[76.79081,35.58123],
           "sia_nga":[76.78760,35.59040],
           "bilafond_osm":[76.94873,35.39186]}
OFFSETS=np.arange(-2010,2011,30,dtype=float)

def fetch(name,url,tmp):
    dest=Path(tmp)/(name+".tif")
    h=hashlib.sha256()
    n=0
    print("DOWNLOAD START",name,url,flush=True)
    with requests.get(url,stream=True,timeout=(30,110),
                      headers={"User-Agent":"Pando Siachen terrain research"}) as r:
        r.raise_for_status()
        if "text/html" in r.headers.get("Content-Type","").lower():
            raise RuntimeError("Nonraster HTML content")
        with dest.open("wb") as fd:
            for part in r.iter_content(1048576):
                if not part:continue
                n+=len(part)
                if n>180*1048576:raise RuntimeError("Raster exceeds source limit")
                fd.write(part);h.update(part)
    with rasterio.open(dest) as a:
        if a.crs is None or a.count<1:raise RuntimeError("DEM is not georeferenced")
        size=[a.width,a.height]
    print("SOURCE FETCHED",name,"bytes",n,"sha",h.hexdigest(),flush=True)
    return dest,{"url":url,"sha256":h.hexdigest(),"bytes":n,"raster_size_px":size}

def grid():
    pts=[TO_UTM.transform(x,y) for x in (BBOX[0],BBOX[2]) for y in (BBOX[1],BBOX[3])]
    x1=min(p[0] for p in pts);x2=max(p[0] for p in pts)
    y1=min(p[1] for p in pts);y2=max(p[1] for p in pts)
    return from_origin(x1,y2,30,30),math.ceil((x2-x1)/30),math.ceil((y2-y1)/30)

def read_aoi(path):
    tr,w,h=grid()
    data=np.full((h,w),np.nan,dtype=np.float32)
    with rasterio.open(path) as a:
        reproject(source=rasterio.band(a,1),destination=data,
                  src_transform=a.transform,src_crs=a.crs,
                  src_nodata=a.nodata,dst_transform=tr,dst_crs=CRS,
                  dst_nodata=np.nan,resampling=Resampling.bilinear)
    data[~((data>2800)&(data<9000))]=np.nan
    valid=float(np.isfinite(data).mean())
    if valid<.70:raise RuntimeError("Warped DEM coverage less than 70%")
    return data,tr,{"shape":[h,w],"valid_fraction":round(valid,6),
                    "min_m":round(float(np.nanmin(data)),1),
                    "max_m":round(float(np.nanmax(data)),1)}

def raster_sample(x,y,a,tr):
    col=(np.array(x)-tr.c)/tr.a-.5
    row=(np.array(y)-tr.f)/tr.e-.5
    return map_coordinates(a,[row,col],order=1,mode="constant",cval=np.nan)

def section(station_km,line,a,tr):
    s=station_km*1000
    p=line.interpolate(s)
    p0=line.interpolate(max(0,s-90));p1=line.interpolate(min(line.length,s+90))
    ux=p1.x-p0.x;uy=p1.y-p0.y;norm=math.hypot(ux,uy)
    nx=uy/norm;ny=-ux/norm
    xx=p.x+OFFSETS*nx;yy=p.y+OFFSETS*ny
    z=raster_sample(xx,yy,a,tr)
    coverage=np.isfinite(z)
    if coverage.mean()<.85:raise RuntimeError("Not enough valid profile cells")
    z=np.interp(np.arange(len(z)),np.flatnonzero(coverage),z[coverage])
    z=gaussian_filter1d(z,1.4)
    center=int(np.argmin(abs(OFFSETS)))
    out={"station_km":station_km,
         "station_lonlat":[round(v,7) for v in TO_GEO.transform(p.x,p.y)],
         "center_elevation_m":round(float(z[center]),1),
         "offsets_m":[int(v) for v in OFFSETS],
         "profile_m":[round(float(v),2) for v in z],
         "search_windows_m":{}}
    for radius in (900,1600):
        inds=np.where(abs(OFFSETS)<=radius)[0]
        at=inds[int(np.argmax(z[inds]))]
        offset=int(OFFSETS[at])
        out["search_windows_m"][str(radius)]={
           "peak_offset_right_east_m":offset,
           "peak_above_line_m":round(float(z[at]-z[center]),1),
           "peak_elevation_m":round(float(z[at]),1),
           "near_search_edge":abs(offset)>=radius-50
        }
    return out

def chart(name,entry):
    fig,ax=plt.subplots(figsize=(10,5))
    for dataset,values in entry["DEM"].items():
        if values is None:continue
        ax.plot(OFFSETS,values["profile_m"],lw=1.6,label=dataset)
        v=values["search_windows_m"]["900"]
        ax.scatter([v["peak_offset_right_east_m"]],[v["peak_elevation_m"]],s=22)
    ax.axvline(0,c="red",ls="--",lw=1.2,label="OSM AGPL approximation")
    ax.axvspan(-900,900,alpha=.045,color="gray")
    ax.set_title("Saltoro research terrain — "+name+", AGPL km "+str(entry["station_km"]))
    ax.set_xlabel("Perpendicular metres (+ = east, IND-facing side of south→north line)")
    ax.set_ylabel("DEM surface elevation in metres")
    ax.grid(alpha=.2);ax.legend(fontsize=8)
    fig.tight_layout()
    filename="siachen_multidem_"+name+".png"
    fig.savefig(OUT/filename,dpi=165);plt.close(fig)
    return filename

def main():
    f=json.loads((OUT/"siachen_agpl_osm_candidate.geojson").read_text())["features"][0]
    assert f["properties"]["osm_relation_version"]==10
    line=transform(TO_UTM.transform,shape(f["geometry"]))
    assert 110000<line.length<120000
    report={"study":"Independent elevation products vs approximate OSM Saltoro control line",
      "status":"cartographic research only; not a border correction",
      "bbox_wgs84":list(BBOX),
      "profiles":"perpendicular +/-2010m at 30m spacing; peak window +/-900 or +/-1600m",
      "source_independence":"SRTMGL1 and NASADEM share SRTM radar lineage; NOT independent checks.",
      "highpoint_caveat":"Maximum height of a normal transect need not be a watershed crest or military border.",
      "sources":{},"failed_sources":{},"stations":{},"public_pass_elevations":{}}
    with tempfile.TemporaryDirectory() as tmp:
        layers={}
        for name,(url,description) in SOURCES.items():
            try:
                tif,meta=fetch(name,url,tmp)
                data,tr,stats=read_aoi(tif)
                layers[name]=(data,tr)
                report["sources"][name]={**meta,"method":description,"clip":stats}
            except Exception as e:
                report["failed_sources"][name]=type(e).__name__+": "+str(e)
                print("SOURCE FAILED",name,report["failed_sources"][name],flush=True)
        if "COP30" not in layers or len(layers)<2:
            raise RuntimeError("Cannot independently check COP30 with any other source")
        for name,k in STATIONS.items():
            entry={"station_km":k,"DEM":{}}
            for dataset,(a,tr) in layers.items():
                try:
                    res=section(k,line,a,tr)
                    entry["DEM"][dataset]=res
                    print("SECTION",name,dataset,
                          "peak900",res["search_windows_m"]["900"],
                          "peak1600",res["search_windows_m"]["1600"],flush=True)
                except Exception as ex:
                    entry["DEM"][dataset]=None
                    print("SECTION FAILED",name,dataset,str(ex)[:100],flush=True)
            entry["figure"]=chart(name,entry)
            report["stations"][name]=entry
        for label,(lon,lat) in LANDMARKS.items():
            x,y=TO_UTM.transform(lon,lat)
            elevations={}
            for name,(a,tr) in layers.items():
                q=float(raster_sample([x],[y],a,tr)[0])
                elevations[name]=round(q,1) if math.isfinite(q) else None
            report["public_pass_elevations"][label]={"lon":lon,"lat":lat,
                                                     "elevation_by_model_m":elevations}
            print("PASS ELEVATION",label,elevations,flush=True)
    for key in ("shift_a","shift_b"):
        v=report["stations"][key]["DEM"]["COP30"]
        if not v:raise RuntimeError("Critical COP30 profile failed")
    (OUT/"siachen_multidem_ridge_comparison.json").write_text(
       json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    docs=["# Saltoro multiple elevation model audit","","Sources successfully loaded: "+", ".join(report["sources"]),
       "Unavailable sources: "+", ".join(report["failed_sources"]),
       "The apparent +890m shift in the older report lies on the edge of the +/-900m search window.",
       "Both +/-900m and +/-1600m samples here test whether the previous conclusion was window-limited.",
       "DEM local transverse high points are NOT a traced mountain ridge, AGPL or surveyed pass positions.",
       "ALOS optical stereo and SRTM radar have snow/ice limits; NASADEM shares SRTM inputs.",
       "Each source URL, byte checksum and validity percentage is recorded in JSON.",
       "No source GeoJSON, state border or control-region area was modified.",""]
    for key,val in report["stations"].items():docs.append("- "+key+": "+val["figure"])
    (OUT/"README_multidem_ridge.md").write_text("\n".join(docs)+"\n",encoding="utf-8")
    print("SUCCESS DEM independent data study",list(report["sources"]),flush=True)

if __name__=="__main__":
    main()
