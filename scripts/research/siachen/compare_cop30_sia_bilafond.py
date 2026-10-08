#!/usr/bin/env python3
"""Compare OSM approximate AGPL with Copernicus DEM GLO-30 topography.

This tool deliberately does not create an amended political border.
The 'local highest transect point' is a heuristic, NOT an official ridgeline.
"""
from __future__ import annotations

import hashlib
import json
import math
import tempfile
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
import requests
from matplotlib.colors import LightSource
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from rasterio.warp import reproject, transform_bounds
from rasterio.transform import from_origin
from scipy.ndimage import gaussian_filter1d, map_coordinates
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform as transform_geom

OUT = Path("assets/data/research/siachen")
OUT.mkdir(parents=True, exist_ok=True)
TILE = "Copernicus_DSM_COG_10_N35_00_E076_00_DEM"
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/" + TILE + "/" + TILE + ".tif"
DEM_INFO_URL = "https://registry.opendata.aws/copernicus-dem/"
# Analysis region covers Sia La – Bilafond La and an approximately 1–2 km margin.
BBOX = (76.690, 35.356, 76.996, 35.622)  # west, south, east, north
PIXEL_M = 30.0
NORMAL_RADIUS_M = 1000
NORMAL_STEP_M = 30
ALONG_STEP_M = 250
UTM = "EPSG:32643"
TO_UTM = Transformer.from_crs("EPSG:4326", UTM, always_xy=True)
TO_WGS = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True)

SOURCES = [
    {"name": "Sia La", "id": "sia_osm", "source": "OSM / Mapcarta", "longitude": 76.79081,
     "latitude": 35.58123, "url": "https://mapcarta.com/14675508", "published_elevation_m":5803},
    {"name": "Sia La", "id": "sia_wikipedia", "source": "Wikipedia georeference", "longitude": 76.79250,
     "latitude": 35.58194, "url": "https://en.wikipedia.org/wiki/Sia_La", "published_elevation_m":5589},
    {"name": "Sia La", "id": "sia_nga", "source": "NGA / Getty TGN", "longitude": 76.7876,
     "latitude": 35.5904, "url": "https://www.getty.edu/vow/TGNFullDisplay?subjectid=7923170"},
    {"name": "Bilafond La", "id": "bila_osm", "source": "OSM / Mapcarta", "longitude": 76.94873,
     "latitude": 35.39186, "url": "https://mapcarta.com/14710602", "published_elevation_m":5450},
    {"name": "Bilafond La", "id": "bila_nga", "source": "NGA / Getty TGN", "longitude": 76.9486,
     "latitude": 35.3922, "url": "https://www.getty.edu/vow/TGNFullDisplay?subjectid=7902300"},
]

def read_feature(file):
    fc=json.loads((OUT/file).read_text(encoding="utf-8"))
    assert fc["type"]=="FeatureCollection" and len(fc["features"])==1
    return fc["features"][0]

def save(file, obj):
    (OUT/file).write_text(json.dumps(obj, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

def download(url, target):
    print("DEM DOWNLOAD", url, flush=True)
    h=hashlib.sha256()
    size=0
    req=requests.get(url,stream=True,timeout=(25,100),headers={"User-Agent":"PandoEditor-Siachen-Topography-Research/1.0"})
    req.raise_for_status()
    ctype=req.headers.get("Content-Type", "")
    if "text/html" in ctype:
        raise RuntimeError("DEM URL returned HTML")
    with target.open("wb") as f:
        for chunk in req.iter_content(1024*1024):
            if not chunk: continue
            size+=len(chunk)
            if size>160*1024*1024: raise RuntimeError("DEM file exceeds 160MB cap")
            h.update(chunk)
            f.write(chunk)
    print("DEM DOWNLOADED BYTES",size,"SHA256",h.hexdigest(), flush=True)
    return {"url":url,"bytes":size,"sha256":h.hexdigest(),"content_type":ctype,
            "dataset":"Copernicus DEM GLO-30 Public, AWS 2021 COG",
            "source_observation":"TanDEM-X 2011–2015, with some void-filling of different dates",
            "pixel_resolution_m_approx":30,"data_type":"DSM (surface elevation), not military ground control",
            "licence_link":"https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
            "attribution":"Copernicus Digital Elevation Model was accessed from " + DEM_INFO_URL}

def load_raster(src_path):
    with rasterio.open(src_path) as r:
        if r.crs is None or r.count<1:
            raise ValueError("DEM missing CRS/band")
        window=from_bounds(*BBOX, transform=r.transform).round_offsets().round_lengths()
        if window.width<100 or window.height<100:
            raise RuntimeError("DEM bbox not covered at expected 30m scale")
        arr=r.read(1,window=window,masked=True).astype("float32").filled(np.nan)
        valid=arr[np.isfinite(arr)]
        print("DEM SOURCE",r.driver, r.width,r.height,str(r.crs),"input",arr.shape,
             "range",float(valid.min()),float(valid.max()),flush=True)
        if len(valid)<arr.size*.99 or valid.min()<0 or valid.max()>9000:
            raise ValueError("DEM missing data or impossible height values")
        west,south,east,north=transform_bounds("EPSG:4326",UTM,*BBOX,densify_pts=21)
        dst_transform=from_origin(west,north,PIXEL_M,PIXEL_M)
        w=math.ceil((east-west)/PIXEL_M)
        h=math.ceil((north-south)/PIXEL_M)
        dst=np.full((h,w),np.nan,dtype="float32")
        reproject(
            source=arr,destination=dst,
            src_transform=r.window_transform(window),src_crs=r.crs,src_nodata=np.nan,
            dst_transform=dst_transform,dst_crs=UTM,dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        good=np.isfinite(dst)
        print("DEM PROJECTED SHAPE", dst.shape,"valid",float(good.mean()),
              "range",float(dst[good].min()),float(dst[good].max()),flush=True)
        if good.mean()<.95:
            raise ValueError("DEM projected coverage unexpectedly low")
        return dst,dst_transform,{"source_crs":str(r.crs),"tile_size":[r.width,r.height],
            "clip_shape_source":list(arr.shape),"warped_grid_shape":list(dst.shape),
            "warped_valid_fraction":round(float(good.mean()),6),
            "warped_min_m":round(float(dst[good].min()),2),
            "warped_max_m":round(float(dst[good].max()),2),
            "warped_resolution_m":PIXEL_M}

def raster_heights(xs,ys,array,affine):
    xx=np.asarray(xs,dtype=float)
    yy=np.asarray(ys,dtype=float)
    col=(xx-affine.c)/affine.a-.5
    row=(yy-affine.f)/affine.e-.5
    z=map_coordinates(array, [row,col], order=1,mode="constant",cval=np.nan)
    return z

def transect(s,line,array,affine,offsets):
    p=line.interpolate(s)
    before=line.interpolate(max(0,s-90))
    after=line.interpolate(min(line.length,s+90))
    vx,vy=(after.x-before.x),(after.y-before.y)
    mag=math.hypot(vx,vy)
    if mag<1: raise ValueError("Degenerate AGPL local line tangent")
    vx/=mag;vy/=mag
    # Source line is south -> north, so positive = right/east/India-facing.
    nx,ny=vy,-vx
    xs=p.x+offsets*nx
    ys=p.y+offsets*ny
    zz=raster_heights(xs,ys,array,affine)
    if np.isfinite(zz).mean()<.97:
        raise RuntimeError("Transect outside valid DEM coverage at s=%.2f" % s)
    # For local topographic comparison, low-pass ~40-60m natural noise.
    zfill=np.interp(np.arange(len(zz)),np.flatnonzero(np.isfinite(zz)),zz[np.isfinite(zz)])
    smooth=gaussian_filter1d(zfill,1.6,mode="nearest")
    sel=(offsets>=-900)&(offsets<=900)
    choices=np.flatnonzero(sel)
    imax=choices[np.argmax(smooth[sel])]
    center=int(np.argmin(np.abs(offsets)))
    z0=float(smooth[center])
    z_max=float(smooth[imax])
    pmax=Point(float(xs[imax]),float(ys[imax]))
    lon,lat=TO_WGS.transform(p.x,p.y)
    plon,plat=TO_WGS.transform(pmax.x,pmax.y)
    return {"station_km":round(s/1000,4),
            "lon":round(lon,7),"lat":round(lat,7),
            "dem_elevation_at_osm_m":round(z0,1),
            "cross_section_local_max_m":round(z_max,1),
            "local_max_offset_right_east_m":int(offsets[imax]),
            "local_max_advantage_m":round(z_max-z0,1),
            "offset_abs_m":abs(int(offsets[imax])),
            "local_max_lon":round(plon,7),"local_max_lat":round(plat,7),
            "west_600m_elev_m":round(float(smooth[np.argmin(abs(offsets+600))]),1),
            "east_600m_elev_m":round(float(smooth[np.argmin(abs(offsets-600))]),1),
            "profile_height_m":smooth.tolist()}

def profile_landmark(landmark,line,array,affine,offsets):
    x,y=TO_UTM.transform(landmark["longitude"],landmark["latitude"])
    point=Point(x,y)
    station=line.project(point)
    p=line.interpolate(station)
    before=line.interpolate(max(0,station-90))
    after=line.interpolate(min(line.length,station+90))
    u,v=after.x-before.x,after.y-before.y
    m=math.hypot(u,v);u/=m;v/=m
    # right/east normal
    nx,ny=v,-u
    signed=(x-p.x)*nx+(y-p.y)*ny
    t=transect(station,line,array,affine,offsets)
    hpt=float(raster_heights([x],[y],array,affine)[0])
    if not math.isfinite(hpt):raise ValueError("Pass point outside DEM")
    obj={k:v for k,v in landmark.items()}
    if "published_elevation_m" in landmark:
        obj["dem_minus_published_elevation_m"]=round(hpt-landmark["published_elevation_m"],1)
    obj.update({"AGPL_nearest_station_km":round(station/1000,3),
                "distance_to_AGPL_m":round(point.distance(p),1),
                "signed_right_east_offset_m":round(signed,1),
                "candidate_AGPL_elevation_m":t["dem_elevation_at_osm_m"],
                "landmark_elevation_dem_m":round(hpt,1),
                "landmark_minus_candidate_height_m":round(hpt-t["dem_elevation_at_osm_m"],1),
                "max_elevation_in_transect_m":t["cross_section_local_max_m"],
                "max_point_right_east_offset_m":t["local_max_offset_right_east_m"],
                "max_minus_candidate_height_m":t["local_max_advantage_m"],
                "candidate_line_side_for_landmark":"IND/east" if signed>0 else "PAK/west"})
    return obj,t

def plot_map(dem,affine,line,glacier,landmarks,transects):
    grid=np.where(np.isfinite(dem),dem,4500)
    # gentle relief shading for visual comparison, not raster data export.
    ls=LightSource(azdeg=315,altdeg=45)
    shade=ls.hillshade(grid,vert_exag=1.0,dx=PIXEL_M,dy=PIXEL_M)
    h,w=grid.shape
    west=affine.c;east=west+w*PIXEL_M
    north=affine.f;south=north-h*PIXEL_M
    fig,ax=plt.subplots(figsize=(9,11))
    ax.imshow(shade,cmap="gray",origin="upper",extent=(west,east,south,north),vmin=.15,vmax=.9)
    ax.imshow(grid,cmap="terrain",origin="upper",extent=(west,east,south,north),alpha=.24,
              vmin=4000,vmax=7600)
    xx=west+(np.arange(w)+.5)*PIXEL_M
    yy=north-(np.arange(h)+.5)*PIXEL_M
    # Downsample contours 2x to keep plot/size manageable.
    ax.contour(xx[::3], yy[::3],grid[::3,::3],
               levels=np.arange(4000,8000,250),colors="white",alpha=.3,linewidths=.4)
    xs,ys=line.xy
    ax.plot(xs,ys,color="#e90047",lw=1.8,label="OSM AGPL candidate (not official)",zorder=7)
    gxy=np.asarray(glacier.exterior.coords)
    ux,uy=TO_UTM.transform(gxy[:,0],gxy[:,1])
    ax.plot(ux,uy,color="#29ffff",lw=.5,alpha=.7,label="RGI 2002 glacier outline")
    proxies=[p for p in transects if p["local_max_advantage_m"]>=80 and abs(p["local_max_offset_right_east_m"])<=900]
    if proxies:
        px,py=TO_UTM.transform([p["local_max_lon"] for p in proxies],[p["local_max_lat"] for p in proxies])
        ax.scatter(px,py,s=6,marker=".",c="#ffff00",alpha=.65,zorder=8,
                   label="Local transect DEM high-points (not boundary)")
    marks={"sia_osm":"o","sia_wikipedia":"s","sia_nga":"^","bila_osm":"o","bila_nga":"^"}
    for landmark in landmarks:
        x,y=TO_UTM.transform(landmark["longitude"],landmark["latitude"])
        ax.scatter([x],[y],marker=marks[landmark["id"]],s=45,edgecolor="#111",linewidth=.6,
                   c="#ffea33",zorder=10)
    for name,loni,lati in [("Sia La",76.7889,35.58123),("Bilafond La",76.949,35.3922)]:
        x,y=TO_UTM.transform(loni,lati)
        ax.annotate(name,(x,y),xytext=(15,12),textcoords="offset points",fontsize=10,
                    color="white",weight="bold",bbox={"facecolor":"black","alpha":.55,"pad":2})
    ax.set_xlim(TO_UTM.transform(BBOX[0],35.49)[0],TO_UTM.transform(BBOX[2],35.49)[0])
    ax.set_ylim(TO_UTM.transform(76.84,BBOX[1])[1],TO_UTM.transform(76.84,BBOX[3])[1])
    ax.set_aspect("equal")
    ax.set_title("Sia La – Bilafond La | Copernicus DEM GLO-30 relief\n"
                 "OSM approximate AGPL and local topographic cross-section maxima",fontsize=11)
    ax.set_xlabel("UTM 43N east (metres)")
    ax.set_ylabel("UTM 43N north (metres)")
    ax.legend(loc="lower left",fontsize=7,facecolor="white",framealpha=.85)
    fig.tight_layout()
    fig.savefig(OUT/"sia_bilafond_cop30_relief.png",dpi=165)
    plt.close(fig)

def plot_profiles(landmarks,profiles,offsets):
    for ident,title in [("sia_osm","Sia La (OSM location)"),("bila_osm","Bilafond La (OSM location)")]:
        landmark=landmarks[ident]
        t=profiles[ident]
        fig,ax=plt.subplots(figsize=(10,5))
        ax.plot(offsets/1000,np.asarray(t["profile_height_m"]),lw=2,color="#315f81",
                label="Copernicus DEM GLO-30 cross-section")
        ax.axvline(0,color="#d32255",lw=1.7,ls="--",label="OSM AGPL estimate")
        lx=landmark["signed_right_east_offset_m"]/1000
        ax.axvline(lx,color="#3a8b4e",lw=1.6,ls=":",label="Public pass coordinate")
        ax.axvline(t["local_max_offset_right_east_m"]/1000,
                   color="#ab6a0a",lw=1.1,ls="-.",label="Nearest transect DEM max ±900 m")
        ax.scatter([lx],[landmark["landmark_elevation_dem_m"]],c="#3a8b4e",s=35,zorder=6)
        ax.set_xlabel("Distance from OSM approximate AGPL (km; + = east / India side)")
        ax.set_ylabel("DSM elevation (m)")
        ax.set_title(title+" | DEM cross-section normal to OSM candidate line")
        ax.grid(alpha=.2);ax.legend(fontsize=8,loc="best")
        fig.tight_layout()
        fig.savefig(OUT/("sia_bilafond_"+ident+"_transect.png"),dpi=185)
        plt.close(fig)

def main():
    agpl=read_feature("siachen_agpl_osm_candidate.geojson")
    glacier=read_feature("siachen_glacier_rgi7.geojson")
    if agpl["properties"].get("osm_relation_version")!=10 or glacier["properties"].get("rgi_id")!="RGI2000-v7.0-G-14-20040":
        raise RuntimeError("Source attribution/identifier mismatch")
    osm_line=shape(agpl["geometry"])
    glacier_geom=shape(glacier["geometry"])
    line=transform_geom(TO_UTM.transform,osm_line)
    if len(line.coords)!=190:
        raise ValueError("Unexpected OSM AGPL candidate geometry")

    with tempfile.TemporaryDirectory() as tmpdir:
        infile=Path(tmpdir)/"cop30.tif"
        meta=download(DEM_URL,infile)
        dem,affine,gridinfo=load_raster(infile)
    offsets=np.arange(-NORMAL_RADIUS_M,NORMAL_RADIUS_M+NORMAL_STEP_M,
                      NORMAL_STEP_M,dtype=float)
    # Ensure OSM line is directed from south to north.
    if osm_line.coords[0][1]>=osm_line.coords[-1][1]:
        raise RuntimeError("OSM AGPL line flipped; signed direction invalid")
    loc={}
    cross={}
    for item in SOURCES:
        site, profile=profile_landmark(item,line,dem,affine,offsets)
        loc[item["id"]]=site
        cross[item["id"]]=profile
        print("PASS CHECK",item["id"],"side",site["candidate_line_side_for_landmark"],
              "dist_m",site["distance_to_AGPL_m"],
              "elev",site["landmark_elevation_dem_m"],
              "line_elev",site["candidate_AGPL_elevation_m"],
              "crosspeakoffset",site["max_point_right_east_offset_m"],
              "crossgain",site["max_minus_candidate_height_m"],flush=True)
    sta_b=loc["bila_osm"]["AGPL_nearest_station_km"]*1000
    sta_s=loc["sia_osm"]["AGPL_nearest_station_km"]*1000
    if not (sta_s-sta_b>19000 and sta_s-sta_b<50000):
        raise ValueError("Unexpected Sia La – Bilafond La sector length")
    ss=np.arange(sta_b,sta_s,ALONG_STEP_M)
    data=[]
    for s in ss:
        t=transect(float(s),line,dem,affine,offsets)
        del t["profile_height_m"]
        data.append(t)
    gains=np.asarray([t["local_max_advantage_m"] for t in data])
    offs=np.asarray([t["local_max_offset_right_east_m"] for t in data])
    alt=np.asarray([t["dem_elevation_at_osm_m"] for t in data])
    result={
        "sources":{"copernicus_dem":meta,"copernicus_dem_processing":gridinfo,
            "agpl_source":"OpenStreetMap relation 13559521 via pinned 2026-10-04 derivative",
            "glacier_source":"RGI 7.0, glacier id RGI2000-v7.0-G-14-20040",
            "landmarks":SOURCES},
        "region_bbox_wgs84":list(BBOX),
        "analysis_method":{
            "description":"Sample local orthogonal terrain profiles ±1 km across OSM line every 250 m. Gaussian-smoothed surface highest point selected in ±900 m for diagnostic ONLY.",
            "ridge_warning":"A cross-section's height maximum is NOT necessarily the watershed crest, and neither identifies an official military line. Mountain passes are saddles.",
            "DEM_pixel_m":PIXEL_M,
            "section_spacing_m":ALONG_STEP_M,
            "section_normal_range_m":NORMAL_RADIUS_M,
            "normal_sampling_m":NORMAL_STEP_M,
            "peak_window_m":900,
            "gaussian_sigma_samples":1.6,
            "right_east_definition":"OSM line direction south→north; + normal distance is right/east/India side.",
            "elevation_units":"metres above Copernicus vertical datum; not validated against surveyed pass heights",
            "geometry_policy":"research only, never replace canonical AGPL or claim to exact land control"
        },
        "sector":{
            "south_station_m":round(sta_b,2),
            "north_station_m":round(sta_s,2),
            "distance_along_osm_agpl_km":round((sta_s-sta_b)/1000,2),
            "sample_count":len(data),
            "median_local_high_point_offset_m":round(float(np.median(offs)),1),
            "median_absolute_offset_m":round(float(np.median(abs(offs))),1),
            "p90_absolute_offset_m":round(float(np.percentile(abs(offs),90)),1),
            "pct_high_point_within_150m":round(float(np.mean(abs(offs)<=150)*100),1),
            "pct_high_point_within_300m":round(float(np.mean(abs(offs)<=300)*100),1),
            "pct_line_ge100m_below_local_max":round(float(np.mean(gains>=100)*100),1),
            "median_line_below_local_max_m":round(float(np.median(gains)),1),
            "mean_line_elevation_m":round(float(np.mean(alt)),1),
        },
        "landmark_checks":loc,
        "terrain_samples":data,
    }
    features=[{"type":"Feature","geometry":mapping(osm_line),"properties":{
              "name":"OSM AGPL approximation, research source, not surveyed",
              "license":"ODbL 1.0","date":"2026-10-04"}}]
    for ident,p in loc.items():
        features.append({"type":"Feature","geometry":{"type":"Point","coordinates":[p["longitude"],p["latitude"]]},
                         "properties":{"name":p["name"],"id":ident,"type":"public_toponym",
                                       "observed_side":p["candidate_line_side_for_landmark"],
                                       "dem_elevation_m":p["landmark_elevation_dem_m"],
                                       "distance_to_osm_agpl_m":p["distance_to_AGPL_m"],
                                       "coordinate_source":p["source"],"url":p["url"]}})
    for i,t in enumerate(data):
        if t["local_max_advantage_m"]<80: continue
        features.append({"type":"Feature",
                         "geometry":{"type":"Point","coordinates":[t["local_max_lon"],t["local_max_lat"]]},
                         "properties":{"type":"transect_elevation_maximum_only","station_index":i,
                             "not_border":True,
                             "candidate_line_elevation_m":t["dem_elevation_at_osm_m"],
                             "offset_right_east_m":t["local_max_offset_right_east_m"],
                             "height_gain_m":t["local_max_advantage_m"]}})
    save("sia_bilafond_dem_comparison.json",result)
    save("sia_bilafond_dem_samples.geojson",{"type":"FeatureCollection","features":features})
    plot_map(dem,affine,line,glacier_geom,list(loc.values()),data)
    plot_profiles(loc,cross,offsets)
    if not (result["sector"]["sample_count"]>60 and
            "sia_osm" in result["landmark_checks"] and
            "bila_osm" in result["landmark_checks"]):
        raise RuntimeError("DEM diagnostic unexpectedly incomplete")
    readme=("# Sia La – Bilafond La: independent terrain cross-check\n\n"
        "Status: research-only topographic comparison. Copernicus DEM GLO-30 Public COG\n"
        "is a digital surface model from TanDEM-X observations 2011–2015, not a surveyed\n"
        "representation of a military control line. It is NOT a current satellite image.\n\n"
        "DEM source: "+DEM_URL+"\n\n"
        "OSM candidate: relation 13559521 (2026-10-04), ODbL 1.0.\n"
        "Physical glacier: RGI 7.0 (2002-07-10). Landform coordinate sources: Mapcarta / NGA Getty.\n\n"
        "Files: sia_bilafond_dem_comparison.json (cross-sections and statistics),\n"
        "sia_bilafond_dem_samples.geojson (line, toponym points, local height-max points),\n"
        "sia_bilafond_cop30_relief.png (relief map and geometry),\n"
        "sia_bilafond_sia_osm_transect.png and sia_bilafond_bila_osm_transect.png.\n\n"
        "Method: sample profiles normal to the existing OSM candidate, select local\n"
        "maxima up to 900m on either side after smoothing. This is a diagnostic\n"
        "topographic statistic and NOT an authoritative ridgeline extraction.\n"
        "A military boundary does not necessarily pass over profile maxima or\n"
        "through pass labels. The OSM boundary should NOT be edited simply by\n"
        "snapping to nearby high points, which may be unrelated peaks/spurs.\n\n"
        "Copernicus attribution: Copernicus Digital Elevation Model, accessed from\n"
        + DEM_INFO_URL + "\n"
        "Full DEM raster not redistributable from this research repository;\n"
        "only derived, source-attributed diagnostic images/measurements are saved.\n\n"
        "Country geometries and the source AGPL candidate are unchanged.\n")
    (OUT/"README_dem_sia_bilafond.md").write_text(readme,encoding="utf-8")
    print("SUCCESS topo QA sector",json.dumps(result["sector"]),flush=True)

if __name__=="__main__":
    main()
