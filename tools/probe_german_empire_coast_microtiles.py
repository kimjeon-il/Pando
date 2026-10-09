#!/usr/bin/env python3
"""High-resolution independent map-window probe for manual shoreline symbol review.

Creates *ephemeral* map images and compact source metadata only. Does NOT
digitize historic land borders automatically or assert 1914 map accuracy.
"""
import base64, hashlib, io, json, os
from pathlib import Path
import requests
from PIL import Image, ImageDraw
from shapely.geometry import box, shape

ROOT=Path(__file__).resolve().parents[1]
DIR=ROOT/"tools/historical-library/review-output/german-coastline-microtiles"
REPORT=ROOT/"tools/historical-library/sources/german-coastline/sh-coast-microtile-source-probe.json"
BASE="https://dienste.gdi-sh.de/WMS_SH_FD_Chronologen"
WIDTH,HEIGHT=1500,1100
TILES=[
 {"id":"beltringharder-northwest-1880","bbox":[8.895,54.578,8.936,54.604],
  "purpose":"Beltringharder 1987 closure / mapped seaward dike-foot vs foreshore"},
 {"id":"hauke-haien-north-1880","bbox":[8.683,54.730,8.738,54.764],
  "purpose":"Hauke-Haien 1958/59 closure / compare seaward coast symbols"}
]
EPOCHS={"3":"1878–1880","2":"1902–1930"}
def raster(session,bbox,layer):
    w,s,e,n=bbox
    params={"SERVICE":"WMS","VERSION":"1.3.0","REQUEST":"GetMap",
            "LAYERS":layer,"STYLES":"","CRS":"EPSG:4326",
            "BBOX":f"{s},{w},{n},{e}", "WIDTH":str(WIDTH),
            "HEIGHT":str(HEIGHT),"FORMAT":"image/png","TRANSPARENT":"TRUE"}
    r=session.get(BASE,params=params,timeout=(20,90))
    r.raise_for_status()
    im=Image.open(io.BytesIO(r.content)).convert("RGBA")
    if im.size!=(WIDTH,HEIGHT) or not im.getchannel("A").getbbox():raise ValueError("blank/invalid map "+str(im.size))
    return im,r
def clip_segments(line,b):
    geom=line.intersection(box(*b))
    if geom.is_empty:return []
    if geom.geom_type=="LineString":return [geom]
    if geom.geom_type=="MultiLineString":return list(geom.geoms)
    return [x for x in getattr(geom,"geoms",[]) if x.geom_type=="LineString"]
def add_modern(src,bbox,line):
    out=Image.new("RGB",(WIDTH,HEIGHT),"white")
    out.paste(src,mask=src.getchannel("A"))
    d=ImageDraw.Draw(out)
    w,s,e,n=bbox
    for seg in clip_segments(line,bbox):
        coords=[((p[0]-w)/(e-w)*(WIDTH-1),(n-p[1])/(n-s)*(HEIGHT-1)) for p in seg.coords]
        if len(coords)>1:
            d.line(coords,fill="white",width=7,joint="curve")
            d.line(coords,fill=(223,33,53),width=3,joint="curve")
    return out
def encode_thumb(im,label):
    x=im.copy()
    x.thumbnail((1160,850))
    out=io.BytesIO()
    x.save(out,"JPEG",quality=72,optimize=True)
    tag=label.upper().replace("-","_")
    print("===BEGIN_GIS_COAST_MICRO_"+tag+"_JPEG===")
    print(base64.b64encode(out.getvalue()).decode("ascii"))
    print("===END_GIS_COAST_MICRO_"+tag+"_JPEG===")
def main():
    DIR.mkdir(parents=True,exist_ok=True)
    REPORT.parent.mkdir(parents=True,exist_ok=True)
    f=json.loads((ROOT/"tools/historical-library/working/german-empire-1914-base.geojson").read_text())["features"][0]
    assert f["properties"]["status"]=="working-base-modern-coast-not-final"
    poly=shape(f["geometry"])
    line=max(poly.geoms,key=lambda x:x.area).exterior
    s=requests.Session()
    s.headers["User-Agent"]="Pando/1914-German-coast-historical-source-audit"
    j={"schemaVersion":1,"asOf":"2026-10-09","status":"microtile-wms-source-probe",
       "service":BASE,"sourceCredit":"© GeoBasis-DE/LVermGeo SH/CC BY 4.0",
       "rasterDimensions":[WIDTH,HEIGHT],
       "sourceEpochNotExactSurveyYear":True,
       "historic1914ShorelineDigitized":False,"historicScreenDeviationMeasured":False,
       "doNotModifyCountryPolygon":True,"tiles":[]}
    for tile in TILES:
        rec=dict(tile)
        rec["layers"]=[]
        for layer,epoch in EPOCHS.items():
            data={"layer":layer,"periodGroup":epoch,"individualSheetSurveyRevisionYearVerified":False}
            try:
                im,resp=raster(s,tile["bbox"],layer)
                image_name=tile["id"]+"-"+layer+"-original.png"
                over_name=tile["id"]+"-"+layer+"-modern-working-coast.jpg"
                im.save(DIR/image_name)
                over=add_modern(im,tile["bbox"],line)
                over.save(DIR/over_name,quality=82)
                data.update({"status":"raster-obtained","bytes":len(resp.content),
                             "rasterSha256":hashlib.sha256(resp.content).hexdigest(),
                             "imageFile":image_name,"overlayFile":over_name})
                if os.environ.get("GIS_LOG_BELTRING_MICRO_IMAGE")=="1":
                    encode_thumb(im, tile["id"]+"-"+layer+"-source")
                    if tile["id"].startswith("beltringharder"):
                        encode_thumb(over,tile["id"]+"-"+layer+"-overlay")
            except Exception as e:
                data.update({"status":"unavailable","error":type(e).__name__+": "+str(e)[:250]})
            rec["layers"].append(data)
        j["tiles"].append(rec)
    j["runId"]=os.environ.get("GITHUB_RUN_ID")
    j["successfulRasters"]=sum(x["status"]=="raster-obtained" for p in j["tiles"] for x in p["layers"])
    REPORT.write_text(json.dumps(j,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("===GIS_MICROTILE_REPORT===")
    print(json.dumps({"successfulRasters":j["successfulRasters"],"runId":j["runId"],
        "tileResults":{p["id"]:[x["status"] for x in p["layers"]] for p in j["tiles"]}}))
if __name__=="__main__":
    main()
