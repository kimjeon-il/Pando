#!/usr/bin/env python3
"""Visual verify manual period-map dyke trace against independent official WMS PNG.

Source raster and image overlays go to Actions artifacts only (not Git source).
"""
import base64, io, json, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import box, shape

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"tools/historical-library/sources/german-coastline/cecilienkoog-1905-dyke-manual-source.json"
CAND=ROOT/"tools/historical-library/working/german-empire-1914-cecilienkoog-1905-seaward-dyke-candidate.geojson"
WORK=ROOT/"tools/historical-library/working/german-empire-1914-base.geojson"
DIR=ROOT/"tools/historical-library/review-output/german-coastline-microtiles"

def text_font(size):
    try:return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",size)
    except OSError:return ImageFont.load_default()

def main():
    src=json.loads(SOURCE.read_text())
    geo=json.loads(CAND.read_text())
    input_name=src["source"]["microtileId"]+"-"+src["source"]["layerName"]+"-original.png"
    inp=DIR/input_name
    assert inp.exists(),"Must first download WMS period source PNG"
    period=Image.open(inp).convert("RGBA")
    width,height=period.size
    bbox=src["source"]["bboxLonLat"]
    w,s,e,n=bbox
    to_image=lambda p:((p[0]-w)/(e-w)*(width-1), (n-p[1])/(n-s)*(height-1))
    mainland=max(shape(json.loads(WORK.read_text())["features"][0]["geometry"]).geoms,key=lambda p:p.area)
    red=mainland.exterior.intersection(box(*bbox))
    original=Image.new("RGBA",period.size,"white")
    original.alpha_composite(period)
    full=Image.new("RGB",(width,height+116),"white")
    full.paste(original.convert("RGB"),(0,40))
    draw=ImageDraw.Draw(full)
    def pt(coords):
        return [(x,y+40) for x,y in [to_image(p) for p in coords]]
    parts=[red] if red.geom_type=="LineString" else list(getattr(red,"geoms",[]))
    for seg in parts:
        if seg.geom_type=="LineString":
            P=pt(list(seg.coords))
            if len(P)>1:
                draw.line(P,fill="white",width=8,joint="curve")
                draw.line(P,fill=(204,40,49),width=4,joint="curve")
    line=geo["features"][0]["geometry"]["coordinates"]
    P=pt(line)
    draw.line(P,fill="white",width=10,joint="curve")
    draw.line(P,fill=(12,111,212),width=5,joint="curve")
    for i,(x,y) in enumerate(P):
        if i%4==0:
            draw.ellipse((x-4,y-4,x+4,y+4),fill=(13,70,191),outline="white",width=1)
    draw.rectangle([0,0,width,39],fill=(24,38,49))
    draw.text((12,9),"Cecilienkoog mapped dyke | WMS 1902-1930 group | sheet date UNVERIFIED",
              fill="white",font=text_font(17))
    draw.rectangle([0,height+40,width,height+116],fill=(24,38,49))
    draw.text((12,height+46),
              "BLUE: traced mapped 1905-era sea dyke (provisional). RED: modern working coast (generalized).",
              fill="white",font=text_font(16))
    draw.text((12,height+75),"NOT validated 1914 high-water coastline. © GeoBasis-DE/LVermGeo SH/CC BY 4.0",
              fill=(206,228,241),font=text_font(16))
    path=DIR/"cecilienkoog-1905-dyke-mapped-line-qa.jpg"
    full.save(path,quality=88,optimize=True)
    if os.environ.get("GIS_LOG_CECILIEN_QA_IMAGE")=="1":
        thumb=full.copy()
        thumb.thumbnail((1190,940))
        buffer=io.BytesIO()
        thumb.save(buffer,"JPEG",quality=73,optimize=True)
        print("===BEGIN_CECILIENKOOG_1905_DYKE_QA_JPEG===")
        print(base64.b64encode(buffer.getvalue()).decode("ascii"))
        print("===END_CECILIENKOOG_1905_DYKE_QA_JPEG===")
    print(json.dumps({"sourceRaster":input_name,"qa":str(path.relative_to(ROOT)),
       "renderedVertices":len(P),"actual1914ShorelineVerified":False},ensure_ascii=False))
if __name__=="__main__":
    main()
