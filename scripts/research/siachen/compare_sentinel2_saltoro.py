#!/usr/bin/env python3
"""Source-pinned Sentinel-2 imagery of Sia La and Bilafond La.
Imagery is not an official border, military-location source, or glacier survey.
"""
from __future__ import annotations
import json, math
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.vrt import WarpedVRT
from rasterio.transform import from_origin
from rasterio.enums import Resampling
from shapely.geometry import shape
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT=Path("assets/data/research/siachen")
ROOT.mkdir(parents=True,exist_ok=True)
STAC="https://earth-search.aws.element84.com/v1/search"
CRS="EPSG:32643"
TF=Transformer.from_crs("EPSG:4326",CRS,always_xy=True)
RASTER_OPTS={"GDAL_DISABLE_READDIR_ON_OPEN":"EMPTY_DIR","CPL_VSIL_CURL_ALLOWED_EXTENSIONS":".tif",
"GDAL_HTTP_MAX_RETRY":"2","GDAL_HTTP_RETRY_DELAY":"2","GDAL_HTTP_CONNECTTIMEOUT":"20",
"GDAL_HTTP_TIMEOUT":"65"}
AREAS={
"sia_la":{"bbox":[76.758,35.556,76.828,35.610],"points":[
("Sia La - OSM",76.79081,35.58123),("Sia La - Wikipedia",76.7925,35.58194),
("Sia La - NGA",76.7876,35.5904)]},
"bilafond_north":{"bbox":[76.893,35.374,76.978,35.432],"points":[
("Bilafond La - OSM",76.94873,35.39186),("Bilafond La - NGA",76.9486,35.3922)]}}
DATES={"2025":"2025-07-15T00:00:00Z/2025-10-10T00:00:00Z",
       "2026":"2026-07-15T00:00:00Z/2026-10-07T23:59:59Z"}
BAD={0,1,3,8,9,10}
# Fixed, reviewed acquisition IDs: reruns cannot silently select different scenes.
PINNED_SCENES={"2025":"S2B_43SFV_20250923_0_L2A",
               "2026":"S2B_43SFV_20260829_0_L2A"}

def features(filename):
    data=json.loads((ROOT/filename).read_text())
    assert data["type"]=="FeatureCollection"
    return data["features"]

def target(bbox, resolution):
    pts=[TF.transform(x,y) for x in (bbox[0],bbox[2]) for y in (bbox[1],bbox[3])]
    xmin=min(p[0] for p in pts); xmax=max(p[0] for p in pts)
    ymin=min(p[1] for p in pts); ymax=max(p[1] for p in pts)
    width=math.ceil((xmax-xmin)/resolution)
    height=math.ceil((ymax-ymin)/resolution)
    return width,height,from_origin(xmin,ymax,resolution,resolution),(xmin,xmax,ymin,ymax)

def read_asset(url, bbox, resolution, resampling):
    w,h,trans,extent=target(bbox,resolution)
    with rasterio.Env(**RASTER_OPTS):
        with rasterio.open(url) as src:
            with WarpedVRT(src,crs=CRS,transform=trans,width=w,height=h,resampling=resampling) as v:
                band=v.read(1,masked=True)
                return band.filled(0).astype(np.float32),extent

def select_asset(item,name):
    val=item.get("assets",{}).get(name,{})
    link=val.get("href","")
    if not link.startswith("https://"):
        raise RuntimeError("Missing public STAC https COG: "+name)
    return link

def list_scenes(dates):
    req={"collections":["sentinel-2-l2a"],"bbox":[76.745,35.365,76.989,35.620],
         "datetime":dates,"limit":100,"query":{"eo:cloud_cover":{"lt":65}}}
    r=requests.post(STAC,json=req,timeout=60)
    r.raise_for_status()
    out=[]
    for item in r.json().get("features",[]):
        b=item.get("bbox",[])
        if len(b)<4:continue
        if not all(b[0]<a["bbox"][0] and b[1]<a["bbox"][1] and b[2]>a["bbox"][2] and b[3]>a["bbox"][3] for a in AREAS.values()):
            continue
        if not all(item.get("assets",{}).get(k,{}).get("href","").startswith("https://") for k in ("red","blue","green","scl")):
            continue
        out.append(item)
    out.sort(key=lambda x:(float(x.get("properties",{}).get("eo:cloud_cover",100)),x["id"]))
    print("STAC CANDIDATES",dates,len(out),[(x["id"],x["properties"].get("eo:cloud_cover")) for x in out[:6]],flush=True)
    return out

def qa_scl(item,aoi):
    try:
        scl,_=read_asset(select_asset(item,"scl"),aoi,60,Resampling.nearest)
        v=scl.astype(np.uint8)
        valid=v!=0
        usable=valid & ~np.isin(v,list(BAD))
        return {"valid":round(float(valid.mean()),4),
                "usable":round(float(usable.mean()),4),
                "cloud":round(float(np.isin(v,[8,9,10]).mean()),4),
                "snow":round(float((v==11).mean()),4)}
    except Exception as e:
        print("QA FAILURE",item["id"],str(e)[:300],flush=True)
        return None

def select_scene(year):
    item_id=PINNED_SCENES[year]
    url="https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/"+item_id
    response=requests.get(url,timeout=55)
    response.raise_for_status()
    item=response.json()
    if item.get("id")!=item_id:
        raise RuntimeError("Pinned STAC item identity differs")
    qa={name:qa_scl(item,a["bbox"]) for name,a in AREAS.items()}
    if any(v is None or v["valid"]<.92 or v["usable"]<.95 for v in qa.values()):
        raise RuntimeError("Pinned scene SCL quality deteriorated or became unavailable: "+item_id)
    cloud=float(item["properties"].get("eo:cloud_cover",100))
    score=min(v["usable"] for v in qa.values())*1.7+sum(v["usable"] for v in qa.values())/len(qa)-cloud/100*.12
    print("PINNED SELECTED",year,item_id,item["properties"].get("datetime"),
          "SCL",qa,"score",round(score,4),flush=True)
    shortlist=[{"item_id":item_id,"datetime":item["properties"].get("datetime"),
                "score":round(score,5),"local_quality":qa,
                "provenance":"Pinned after initial candidate ranking and visual review on 2026-10-08"}]
    return item,qa,shortlist

def rgb_crop(item,aoi):
    bands={}
    extent=None
    for key in ("red","green","blue","scl"):
        ar,e=read_asset(select_asset(item,key),aoi,10,
                        Resampling.nearest if key=="scl" else Resampling.bilinear)
        if extent is not None and extent!=e:raise RuntimeError("Misregistered band")
        extent=e
        bands[key]=ar
    scl=bands["scl"].astype(np.uint8)
    valid=(scl!=0)&~np.isin(scl,list(BAD))
    refl=np.stack([bands[k] for k in ("red","green","blue")],axis=-1)
    if valid.mean()<.55:raise RuntimeError("Image quality insufficient")
    vals=refl[valid]
    stretch_hi=max(float(np.percentile(vals,99.2)),1500)
    stretch_lo=max(0,float(np.percentile(vals,2))*.5)
    display=np.power(np.clip((refl-stretch_lo)/(stretch_hi-stretch_lo),0,1),.82)
    display[~valid]*=.32
    q={"shape":list(scl.shape),"clear_fraction":round(float(valid.mean()),4),
       "cloud_fraction":round(float(np.isin(scl,[8,9,10]).mean()),4),
       "snow_ice_class_fraction":round(float((scl==11).mean()),4),
       "display_stretch_hi":round(stretch_hi,1)}
    return display,extent,q

def plot_crop(img,extent,area,year,date,source_line,ice,peaks):
    fig,ax=plt.subplots(figsize=(10,10))
    ax.imshow(img,extent=extent,origin="upper")
    lonlat=list(source_line.coords)
    xx,yy=TF.transform([x for x,y in lonlat],[y for x,y in lonlat])
    ax.plot(xx,yy,color="#ff3a5d",linewidth=1.5,label="OSM AGPL approximation",zorder=7)
    border=list(ice.exterior.coords)
    x,y=TF.transform([v[0] for v in border],[v[1] for v in border])
    ax.plot(x,y,color="#15e8ee",linewidth=.6,alpha=.6,label="RGI 7.0 ice outline (2002)",zorder=6)
    peak_features=[q for q in peaks if q["properties"].get("type")=="transect_elevation_maximum_only"]
    if peak_features:
        ps=[q["geometry"]["coordinates"] for q in peak_features]
        x,y=TF.transform([p[0] for p in ps],[p[1] for p in ps])
        ax.scatter(x,y,color="#f5df1e",s=5,alpha=.7,label="DEM transect high points (not border)",zorder=8)
    for name,lon,lat in area["points"]:
        x,y=TF.transform(lon,lat)
        mark="^" if "NGA" in name else ("s" if "Wikipedia" in name else "o")
        ax.scatter([x],[y],marker=mark,s=45,color="#ffff51",edgecolors="#111",linewidths=.7,zorder=11)
        ax.annotate(name.split(" - ")[-1],(x,y),textcoords="offset points",xytext=(7,8),
                    color="white",fontsize=8,bbox={"facecolor":"black","alpha":.6,"pad":1},zorder=12)
    ax.set_xlim(extent[0],extent[1]);ax.set_ylim(extent[2],extent[3]);ax.set_aspect("equal")
    ax.set_xlabel("UTM zone 43N easting (m)");ax.set_ylabel("UTM zone 43N northing (m)")
    ax.set_title(year+" Sentinel-2 L2A "+date+" | "+area.get("label","Saltoro ridge"))
    ax.grid(color="white",alpha=.12)
    ax.legend(loc="lower left",fontsize=7,framealpha=.85)
    fig.text(.5,.012,"© Copernicus Sentinel data / © OpenStreetMap contributors (ODbL) / RGI 7.0 (CC BY 4.0). Research overlay, not legal border.",ha="center",fontsize=7)
    fig.tight_layout(rect=(0,.024,1,1))
    return fig

def main():
    geom=features("siachen_agpl_osm_candidate.geojson")[0]
    ice=features("siachen_glacier_rgi7.geojson")[0]
    assert geom["properties"]["osm_relation_version"]==10
    assert ice["properties"]["rgi_id"]=="RGI2000-v7.0-G-14-20040"
    line=shape(geom["geometry"])
    glacier=shape(ice["geometry"])
    peaks=features("sia_bilafond_dem_samples.geojson")
    report={"source":"Copernicus Sentinel-2 L2A; Earth Search v1 hosted by Element84",
            "stac_search":STAC,"generated_utc":datetime.now(timezone.utc).isoformat(),
            "pinned_item_ids":PINNED_SCENES,
            "selection_policy":"Frozen scene IDs after clear-scene rank and visual review; reruns must not silently swap acquisitions.",
            "study_area":AREAS,
            "classification":"SCL 0,1,3,8,9,10 excluded; snow/ice class 11 retained. Seasonal snow is not permanent glacier.",
            "interpretation_warning":"Imagery is neither surveyed AGPL nor evidence of military outpost locations; no country geometry changed.",
            "scenes":{}}
    for year in ("2025","2026"):
        item,qa,shortlist=select_scene(year)
        props=item["properties"]
        record={"item_id":item["id"],"datetime":props.get("datetime"),
                "platform":props.get("platform"),"metadata_cloud_pct":props.get("eo:cloud_cover"),
                "assets":{k:select_asset(item,k) for k in ("red","green","blue","scl")},
                "local_scl_60m":qa,"ranked_candidates":shortlist,"images":{}}
        for name,area in AREAS.items():
            img,extent,quality=rgb_crop(item,area["bbox"])
            fig=plot_crop(img,extent,{"points":area["points"],"label":name},year,
                          record["datetime"][:10],line,glacier,peaks)
            outfile="siachen_s2_"+year+"_"+name+"_optical.png"
            fig.savefig(ROOT/outfile,dpi=160)
            plt.close(fig)
            record["images"][name]={"path":outfile,"quality":quality}
            print("OPTICAL SAVED",outfile,"quality",quality,flush=True)
        report["scenes"][year]=record
    (ROOT/"siachen_s2_optical_comparison.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    doc=["# Siachen / Saltoro — Sentinel-2 optical cross-check","",
         "Research-only orthorectified imagery, not an official international boundary.",
         "These 10m images are recorded with exact STAC identifiers/observation timestamps in the JSON.",
         "No military positions or sovereign boundaries are inferred.",
         ""]
    for year,r in report["scenes"].items():
        doc.append(year+": "+r["item_id"]+" — "+r["datetime"])
    doc += ["","A SCL cloud/shadow mask excludes clouds and retain snow/ice; snow colour does not prove glacier extent.",
           "Data: Copernicus Sentinel data / ESA, COG indexed by Element84 Earth Search.",
           "Overlay: OSM AGPL candidate, ODbL 1.0; RGI 7.0 ice polygon, CC BY 4.0.",
           "The AGPL is approximate and neither accepted as treaty boundary nor edited here.",
           "PNG images and source metadata are stored in this research directory.",""]
    (ROOT/"README_s2_optical.md").write_text("\n".join(doc))
    print("SUCCESS Sentinel-2 source-attributed optical overlays and georegistration",flush=True)

if __name__=="__main__":
    main()
