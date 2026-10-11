#!/usr/bin/env python3
"""RGI 7.0 Siachen glacier extractor. Does not assert sovereignty or AGPL."""
from pathlib import Path
import os, json, zipfile, hashlib, shutil, tempfile
import requests
import geopandas as gpd
from shapely.geometry import shape, mapping
from shapely import force_2d
from shapely.ops import transform
from pyproj import Transformer
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT=Path("assets/data/research/siachen")
OUT.mkdir(parents=True,exist_ok=True)
RGI_ID="RGI2000-v7.0-G-14-20040"
RGI_URLS=[
"https://ihp-wins.unesco.org/dataset/randolph-glacier-inventory-rgi-7-0-glacier-product/resource/d4adeac9-e01b-4554-8ec8-6b1d3936b537/download",
"https://daacdata.apps.nsidc.org/pub/DATASETS/nsidc0770_rgi_v7/regional_files/RGI2000-v7.0-G/RGI2000-v7.0-G-14_south_asia_west.zip",
"https://cluster.klima.uni-bremen.de/~fmaussion/misc/rgi7_data/l4_rgi7b0/RGI2000-v7.0-G-14_south_asia_west.zip"]
NE_URLS={
"50m":"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_breakaway_disputed_areas.geojson",
"10m":"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_disputed_areas.geojson"}
CITATION="RGI Consortium (2023). Randolph Glacier Inventory, Version 7.0. https://doi.org/10.5067/F6JMOVY5NAVZ"
def download(url,out,limit=300):
    print("Downloading",url,flush=True)
    h=hashlib.sha256()
    size=0
    with requests.get(url,stream=True,timeout=(20,80),headers={"User-Agent":"Pando Siachen GIS"}) as r:
        r.raise_for_status()
        if "text/html" in r.headers.get("Content-Type","").lower(): raise RuntimeError("HTML/login response")
        with open(out,"wb") as dst:
            for c in r.iter_content(1048576):
                if not c: continue
                size+=len(c)
                if size>limit*1048576: raise RuntimeError("Download size cap reached")
                dst.write(c);h.update(c)
    print("Downloaded",size,"bytes, sha256",h.hexdigest(),flush=True)
    return h.hexdigest()
def dump(path,features):
    path.write_text(json.dumps({"type":"FeatureCollection","features":features},ensure_ascii=False,separators=(",",":"),default=str)+"\n")
def feat(geometry,properties):
    return {"type":"Feature","geometry":mapping(geometry),"properties":properties}
def glacier_from_zip(d):
    failures=[]
    for url in RGI_URLS:
        archive=Path(d)/"region14.zip"
        try:
            checksum=download(url,archive)
            if not zipfile.is_zipfile(archive): raise RuntimeError("Not ZIP")
            with zipfile.ZipFile(archive) as z:
                shps=[n for n in z.namelist() if n.endswith(".shp") and Path(n).name=="RGI2000-v7.0-G-14_south_asia_west.shp"]
                if len(shps)!=1: raise RuntimeError("Expected one RGI glacier SHP, found "+str(shps))
                prefix=shps[0][:-4]
                for ext in (".shp",".shx",".dbf",".prj",".cpg"):
                    member=prefix+ext
                    if member in z.namelist():
                        with z.open(member) as src,open(Path(d)/(Path(prefix).name+ext),"wb") as dst:
                            shutil.copyfileobj(src,dst)
            frame=gpd.read_file(Path(d)/"RGI2000-v7.0-G-14_south_asia_west.shp",engine="pyogrio",where="rgi_id = '"+RGI_ID+"'")
            if len(frame)!=1: raise RuntimeError("RGI id matched "+str(len(frame))+" polygons")
            return frame.to_crs(4326),url,checksum
        except Exception as exc:
            print("SOURCE FAILED",url,type(exc).__name__,str(exc),flush=True)
            failures.append(str(exc))
    raise RuntimeError("No verified RGI7 source available: "+"; ".join(failures))
def disputed(url,d):
    p=Path(d)/"ne.geojson"
    checksum=download(url,p,10)
    data=json.loads(p.read_text())
    found=[f for f in data["features"] if any("siachen" in str(f["properties"].get(k,"")).lower() for k in ("NAME","ADMIN","BRK_NAME","NAME_LONG"))]
    if len(found)!=1: raise RuntimeError("Natural Earth Siachen matches: "+str(len(found)))
    return force_2d(shape(found[0]["geometry"])),found[0]["properties"],checksum
def paint(ax,geo,color,fill,label,style="-",weight=1.3):
    polygons=list(geo.geoms) if geo.geom_type=="MultiPolygon" else [geo]
    for i,p in enumerate(polygons):
        x,y=zip(*[(c[0],c[1]) for c in p.exterior.coords])
        ax.fill(x,y,facecolor=fill,edgecolor=color,linewidth=weight,linestyle=style,label=label if i==0 else None,alpha=.85)
        for ring in p.interiors:
            hx,hy=zip(*[(c[0],c[1]) for c in ring.coords])
            ax.fill(hx,hy,color="white",linewidth=0)
def main():
    with tempfile.TemporaryDirectory() as d:
        frame,rgiurl,rgisha=glacier_from_zip(d)
        row=frame.iloc[0]
        glacier=force_2d(row.geometry)
        if glacier.is_empty or not glacier.is_valid: raise RuntimeError("Invalid glacier geometry")
        project=Transformer.from_crs(4326,32643,always_xy=True)
        meters=lambda g:transform(project.transform,g)
        glacier_m=meters(glacier)
        area=glacier_m.area/1e6
        cp=glacier.centroid
        if not (76.5<cp.x<77.6 and 35.0<cp.y<35.8 and 200<area<2000):
            raise RuntimeError("RGI glacier fails Siachen spatial/area sanity checks")
        attrs={key:str(row[key]) for key in ("rgi_id","glims_id","glac_name","src_date","area_km2","o2region") if key in row.index}
        gfeature=feat(glacier,{"name":"Siachen Glacier","name_ko":"사이첸빙하","feature_type":"physical_glacier_outline","rgi_id":RGI_ID,"RGI_attrs":attrs,"area_km2_UTM43":round(area,3),"citation":CITATION,"license":"CC BY 4.0","source_url":rgiurl,"source_sha256":rgisha,"is_political_boundary":False})
        dump(OUT/"siachen_glacier_rgi7.geojson",[gfeature])
        overlay=[gfeature]
        comparisons={}
        political_geoms={}
        for scale,url in NE_URLS.items():
            p,metadata,sha=disputed(url,d)
            if not p.is_valid: raise RuntimeError("Invalid NE disputed polygon "+scale)
            pm=meters(p)
            overlap=glacier_m.intersection(pm).area/1e6
            stats={"natural_earth_area_km2":round(pm.area/1e6,3),"glacier_area_km2":round(area,3),"overlap_km2":round(overlap,3),"glacier_outside_dispute_km2":round(area-overlap,3),"glacier_inside_dispute_pct":round(overlap/area*100,2),"dispute_outside_glacier_km2":round(pm.area/1e6-overlap,3),"natural_earth_sha256":sha,"natural_earth_url":url}
            comparisons[scale]=stats
            political_geoms[scale]=p
            nf=feat(p,{"name":"Natural Earth Siachen disputed area","feature_type":"political_disputed_area_not_glacier","scale":scale,"license":"public domain","brk_a3":metadata.get("BRK_A3"),"source_url":url,"sha256":sha})
            dump(OUT/("siachen_dispute_ne_"+scale+".geojson"),[nf])
            overlay.append(nf)
            print(scale,stats,flush=True)
        dump(OUT/"siachen_comparison_overlay.geojson",overlay)
        results={"rgi_id":RGI_ID,"glacier_area_km2_UTM43":round(area,3),"glacier_centroid_lonlat":[cp.x,cp.y],"glacier_bounds_lonlat":list(glacier.bounds),"valid_geometry":glacier.is_valid,"rgi_attributes":attrs,"rgi_source_url":rgiurl,"rgi_sha256":rgisha,"natural_earth":comparisons,"note":"NE polygons depict dispute not physical glacier; AGPL NOT modeled."}
        (OUT/"siachen_comparison.json").write_text(json.dumps(results,ensure_ascii=False,indent=2)+"\n")
        fig,ax=plt.subplots(figsize=(10,8))
        paint(ax,political_geoms["50m"],"purple","none","Natural Earth dispute 1:50m","--",2)
        paint(ax,political_geoms["10m"],"orangered","none","Natural Earth dispute 1:10m",weight=1.3)
        paint(ax,glacier,"teal","lightblue","Actual glacier outline (RGI 7.0)",weight=.5)
        ax.set_title("Siachen: physical glacier vs cartographic disputed area")
        ax.set_xlabel("Longitude E");ax.set_ylabel("Latitude N")
        ax.set_aspect(1/0.815);ax.grid(alpha=.15);ax.legend(loc="upper right")
        fig.tight_layout();fig.savefig(OUT/"siachen_comparison.png",dpi=180);plt.close(fig)
        readme=("# Siachen glacier geometry: research output\n\n"
        "Not merged into country borders. RGI depicts natural ice boundaries, not AGPL.\n\n"
        "RGI ID: "+RGI_ID+"\n\nSource: "+CITATION+"\n\n"
        "RGI 14 region includes imagery mainly from around 2002, not a 2026 snapshot.\n\n"
        "RGI archive: "+rgiurl+"\n\nInput SHA256: "+rgisha+"\n\n"
        "Area (EPSG:32643 UTM): "+format(area,'.3f')+" km2\n\n"
        "Files: siachen_glacier_rgi7.geojson (ice geometry); "
        "siachen_dispute_ne_50m.geojson and _10m.geojson (political shapes); "
        "siachen_comparison_overlay.geojson; siachen_comparison.json; siachen_comparison.png.\n\n"
        "Licenses: RGI7 CC BY 4.0, Natural Earth public domain.\n")
        (OUT/"README.md").write_text(readme,encoding="utf-8")
        print("SUCCESS. All polygon files extracted and compared.",flush=True)
if __name__=="__main__": main()
