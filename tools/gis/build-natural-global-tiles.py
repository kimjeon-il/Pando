#!/usr/bin/env python3
"""Produce one immutable all-world six-LOD natural-color tile edition.

The native acquisition is BMNG July 2004, 21600x10800 (LOD4).
LOD0-3 are filtered reductions; LOD5 is explicitly a 2x nearest display
upsample, NOT additional observed geographical detail. Exactly nine LOD4
parents can carry the already verified WorldCover/RGI7/polar candidate;
their corrections taper to the unmodified NASA base at the edge of the
sample coverage. The all-world WorldCover/ice expansion is NOT complete.

This writes only candidate WebP/manifest files. No DEM, coastline,
operational project pin, or existing immutable edition is changed.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
from PIL import Image

VERSION = "0.2.0-world.1"
TILE_SIZE = 1024
OUTPUT_COUNT = 1280
IMAGE_SIZE = (21600,10800)
NASA_SHA = "dea8b4dc8a4f93f5f8bce0c8c85a508a178e7901e9ed8e6bf86e6ce7ef6d61e2"

def sha(data):
    return hashlib.sha256(data).hexdigest()

def load_old():
    spec = importlib.util.spec_from_file_location("natural_sample_grid",
        Path(__file__).with_name("build-natural-surface-samples.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def ease(t):
    t = max(0.0,min(1.0,t))
    return t*t*(3-2*t)

def blend_patch(base, observed, feather=64):
    """Sample-only correction fades into native NASA color; sea sentinel survives."""
    if base.size != observed.size:
        raise ValueError("Observed mask tile is not aligned with the native DEM grid")
    width,height=base.size
    xp=[ease(min(x,width-1-x)/feather) for x in range(width)]
    yp=[ease(min(y,height-1-y)/feather) for y in range(height)]
    pixels=observed.load()
    mask=Image.new("L",base.size)
    weights=bytearray(width*height)
    for y in range(height):
        for x in range(width):
            r,g,b=pixels[x,y][:3]
            # WorldCover water sentinel must remain invalid. Never blend
            # black water into an apparently valid dark coastal pigment.
            weights[y*width+x]=255 if (r,g,b)==(0,0,0) else round(255*xp[x]*yp[y])
    mask.frombytes(bytes(weights))
    return Image.composite(observed,base,mask)

def encode(image, path, register, key):
    stream=io.BytesIO()
    image.save(stream,format="WEBP",lossless=True,quality=80,method=4,exact=True)
    blob=stream.getvalue()
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("xb") as writer:
        writer.write(blob)
    register[key]={"bytes":len(blob),"sha256":sha(blob),
                   "pixelWidth":image.width,"pixelHeight":image.height}
    return len(blob)

def self_test():
    from PIL import Image
    base=Image.new("RGBA",(130,130),(40,150,70,255))
    obs=Image.new("RGBA",(130,130),(240,242,250,255))
    modified=blend_patch(base,obs)
    assert modified.getpixel((0,65))==base.getpixel((0,65))
    assert modified.getpixel((65,65))==obs.getpixel((65,65))
    assert modified.getpixel((30,65)) not in (base.getpixel((30,65)),obs.getpixel((30,65)))
    obs.putpixel((1,5),(0,0,0,255))
    assert blend_patch(base,obs).getpixel((1,5))==(0,0,0,255)
    # A parent 2x upsample is cut into two 1024-pixel children plus gutters.
    source=Image.new("RGBA",(1026,1026))
    for i in range(1026):
        source.putpixel((i,5),(i%255,0,0,255))
    enlarged=source.resize((2052,2052),resample=Image.Resampling.NEAREST)
    left=enlarged.crop((1,1,1027,1027))
    right=enlarged.crop((1025,1,2051,1027))
    for y in (9,100,1025):
        assert left.getpixel((1024,y))==right.getpixel((0,y))
        assert left.getpixel((1025,y))==right.getpixel((1,y))
    return {"edgePatchFade":True,"waterSentinelPreserved":True,
            "upsampledSiblingGutters":True,"newGeographicDetailAtLod5":False}

def build(source_path,source_sha,observed_manifest_path,observed_root,outdir):
    source_path=Path(source_path).resolve()
    observed_root=Path(observed_root).resolve()
    outdir=Path(outdir).resolve()
    if outdir.exists():
        raise ValueError("Immutable world edition already exists")
    if source_sha!=NASA_SHA or sha(source_path.read_bytes())!=source_sha:
        raise ValueError("Unpinned or corrupted NASA BMNG source")
    observed=json.loads(Path(observed_manifest_path).read_text("utf8"))
    if observed.get("version")!="0.1.0-preview.2" or len(observed.get("tiles",{}))!=9:
        raise ValueError("Observed correction input is not the approved nine-region edition")
    if not observed["sources"] or observed["sources"][0]["sha256"]!=NASA_SHA:
        raise ValueError("Observed correction has a different BMNG source")
    Image.MAX_IMAGE_PIXELS=300_000_000
    with Image.open(source_path) as src:
        if src.size!=IMAGE_SIZE or src.format!="JPEG":
            raise ValueError("Wrong BMNG source dimensions/format")
        native=src.convert("RGB")
    helper=load_old()
    levels=helper.grid()
    tiles={}
    outdir.mkdir(parents=True)
    total=0
    for level in levels[:5]:
        if level["id"]==4:
            image=native
        else:
            image=native.resize((level["width"],level["height"]),
                                resample=Image.Resampling.LANCZOS)
        for row in range(level["rows"]):
            for col in range(level["columns"]):
                left,top=col*TILE_SIZE,row*TILE_SIZE
                width=min(TILE_SIZE,level["width"]-left)
                height=min(TILE_SIZE,level["height"]-top)
                key=f'{level["id"]}/{col}-{row}.webp'
                picture=helper.crop_with_gutter(image,left,top,width,height)
                if level["id"]==4 and key in observed["tiles"]:
                    record=observed["tiles"][key]
                    observed_path=observed_root/key
                    payload=observed_path.read_bytes()
                    if len(payload)!=record["bytes"] or sha(payload)!=record["sha256"]:
                        raise ValueError("Observed correction has a different immutable identity: "+key)
                    with Image.open(io.BytesIO(payload)) as file:
                        correction=file.convert("RGBA")
                    if correction.size!=picture.size:
                        raise ValueError("Misregistered observed tile: "+key)
                    picture=blend_patch(picture,correction)
                total+=encode(picture,outdir/key,tiles,key)
        if level["id"]!=4:
            del image
    # No 43200x21600 global raster. Double each native LOD4 parent in
    # isolation; upscaling is a presentation representation, not new detail.
    level5=levels[5]
    for row4 in range(levels[4]["rows"]):
        for col4 in range(levels[4]["columns"]):
            parent_path=outdir/f"4/{col4}-{row4}.webp"
            with Image.open(parent_path) as parent:
                picture=parent.convert("RGBA")
            doubled=picture.resize((picture.width*2,picture.height*2),
                                   resample=Image.Resampling.NEAREST)
            for offset_y in (0,1):
                row5=row4*2+offset_y
                if row5>=level5["rows"]:continue
                h=min(TILE_SIZE,level5["height"]-row5*TILE_SIZE)
                for offset_x in (0,1):
                    col5=col4*2+offset_x
                    if col5>=level5["columns"]:continue
                    w=min(TILE_SIZE,level5["width"]-col5*TILE_SIZE)
                    left,top=offset_x*TILE_SIZE+1,offset_y*TILE_SIZE+1
                    tile=doubled.crop((left,top,left+w+2,top+h+2))
                    if tile.size!=(w+2,h+2):
                        raise ValueError("LOD5 bounds or texture gutter drift")
                    key=f"5/{col5}-{row5}.webp"
                    total+=encode(tile,outdir/key,tiles,key)
            del doubled,picture
    assert len(tiles)==OUTPUT_COUNT,(len(tiles),OUTPUT_COUNT)
    manifest={
        "schema":"pando-natural-surface-v1","version":VERSION,
        "pathPrefix":f"terrain/natural/v{VERSION}",
        "crs":"EPSG:4326","extent":[-180,-90,180,90],
        "registration":"cell-center","gutter":1,
        "tileFormat":"lossless WebP RGBA","alpha":255,"colorSpace":"sRGB",
        "shadeIncluded":False,"historicalReconstruction":False,
        "referenceDate":"2004-07","status":"preview","mixWeight":0.65,
        "levels":levels,"tiles":tiles,"sources":observed["sources"],
        "maskReferenceDate":"2021 (WorldCover and polar) / RGI7 circa 2000",
        "nativeNaturalColorDimensions":[21600,10800],
        "nativeNaturalColorMaxLevel":4,
        "lod5EffectiveSourceResolution":"LOD4 2x nearest resampling, zero additional geographic information",
        "observedPatchCount":len(observed["tiles"]),
        "observedPatchKeys":sorted(observed["tiles"]),
        "coverageScope":"worldwide natural base at every LOD; WorldCover/RGI/polar only at nine observed reference locations",
        "limitations":[
            "WorldCover 2021 10m NOT yet globally mosaicked; present 3-degree review windows only",
            "RGI7 mountain glaciers NOT yet globally mosaicked; Himalayan sample only",
            "Greenland and Antarctica 2021 ice masks applied only inside their reference sample tiles",
            "LOD5 is explicitly interpolated from NASA 2004 21600x10800 native resolution",
            "Natural NASA coast is NOT geometry: current physical land mask always has precedence",
            "Historical vegetation/ice status is NOT reconstructed; keep this candidate opt-in"
        ]
    }
    with (outdir/"manifest.json").open("x",encoding="utf8") as f:
        json.dump(manifest,f,indent=2,ensure_ascii=False);f.write("\n")
    receipt={"schema":"pando-natural-world-preview-v1","version":VERSION,
        "tileCount":len(tiles),"tileBytes":total,
        "sourceSha256":source_sha,"observedTileCount":len(observed["tiles"]),
        "observedSourceHashes":[e["sha256"] for e in observed["tiles"].values()],
        "tests":self_test(),"runtimePinChanged":False,
        "worldCoverGlobalComplete":False,"globalGlacierAndPolarComplete":False}
    with (outdir/"generation-receipt.json").open("x",encoding="utf8") as f:
        json.dump(receipt,f,indent=2);f.write("\n")
    print(json.dumps(receipt,indent=2),flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--self-test",action="store_true")
    parser.add_argument("--source")
    parser.add_argument("--source-sha256")
    parser.add_argument("--observed-manifest")
    parser.add_argument("--observed-root")
    parser.add_argument("--output")
    args=parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test()));return
    if not all((args.source,args.source_sha256,args.observed_manifest,args.observed_root,args.output)):
        parser.error("--source --source-sha256 --observed-manifest --observed-root --output required")
    build(args.source,args.source_sha256,args.observed_manifest,args.observed_root,args.output)

if __name__=="__main__":
    main()
