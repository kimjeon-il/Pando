#!/usr/bin/env python3
"""Derive a non-final Cecilienkoog 1905 sea-dyke LINE candidate from an
explicit manual trace of the official 1902–1930-group historical map.

DO NOT infer a 1914 tidal shoreline or land polygon from this line.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SRC=ROOT/"tools/historical-library/sources/german-coastline/cecilienkoog-1905-dyke-manual-source.json"
PROBE=ROOT/"tools/historical-library/sources/german-coastline/sh-coast-microtile-source-probe.json"
POLYGON=ROOT/"tools/historical-library/working/german-empire-1914-base.geojson"
OUT=ROOT/"tools/historical-library/working/german-empire-1914-cecilienkoog-1905-seaward-dyke-candidate.geojson"
QA=ROOT/"tools/historical-library/working/german-empire-1914-cecilienkoog-1905-seaward-dyke-candidate.qa.json"
CSS_PER_DEG=2560*64/360

def read(path):return json.loads(path.read_text(encoding="utf-8"))
def write(path, data, check):
    content=json.dumps(data, ensure_ascii=False, indent=2)+"\n"
    if check:
        if not path.exists() or path.read_text(encoding="utf-8")!=content:
            raise RuntimeError("candidate artifact is not reproducible or is stale: "+str(path))
    else:
        path.write_text(content,encoding="utf-8")

def xy_to_lonlat(p,bbox,im):
    x,y=p
    w,s,e,n=bbox
    width=im["thumbnailWidthPx"]
    height=im["thumbnailHeightPx"]
    return [round(w+x/(width-1)*(e-w),9),round(n-y/(height-1)*(n-s),9)]

def point_segment_px(p,a,b):
    x,y=p[0]*CSS_PER_DEG,p[1]*CSS_PER_DEG
    ax,ay=a[0]*CSS_PER_DEG,a[1]*CSS_PER_DEG
    dx,dy=(b[0]-a[0])*CSS_PER_DEG,(b[1]-a[1])*CSS_PER_DEG
    norm=dx*dx+dy*dy
    t=max(0,min(1,((x-ax)*dx+(y-ay)*dy)/norm)) if norm>0 else 0
    return math.hypot(x-(ax+t*dx), y-(ay+t*dy))

def nearest_px(p, reference):
    return min(point_segment_px(p,a,b) for a,b in zip(reference,reference[1:]))

def seglen_m(a,b):
    lat=math.radians((a[1]+b[1])/2)
    return 111195*math.hypot((b[0]-a[0])*math.cos(lat),b[1]-a[1])

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--check",action="store_true")
    args=parser.parse_args()
    source=read(SRC)
    probe=read(PROBE)
    assert source["referenceDate"]=="1914-07-31"
    assert source["validation"]["actual1914TideDefinedShorelineDigitized"] is False
    assert source["validation"]["promoteToCountryPolygon"] is False
    raster=source["source"]
    tile=next(x for x in probe["tiles"] if x["id"]==raster["microtileId"])
    layer=next(x for x in tile["layers"] if x["layer"]==raster["layerName"])
    assert tile["bbox"]==raster["bboxLonLat"]
    assert layer["status"]=="raster-obtained"
    assert layer["rasterSha256"]==raster["imageSha256"], "Source raster changed: retrace original"
    assert source["sourceEpochGroup"]=="1902-1930"
    points=source["manualRasterPoints"]
    width,height=source["traceImageFrame"]["thumbnailWidthPx"],source["traceImageFrame"]["thumbnailHeightPx"]
    assert len(points)>=10 and all(0<=x<width and 0<=y<height for x,y in points)
    lonlat=[xy_to_lonlat(p,raster["bboxLonLat"],source["traceImageFrame"]) for p in points]
    assert len(set(tuple(p) for p in lonlat))==len(lonlat)
    pfile=POLYGON.read_bytes()
    git_blob_sha=hashlib.sha1(b"blob "+str(len(pfile)).encode()+b"\0"+pfile).hexdigest()
    modern=read(POLYGON)["features"][0]
    assert modern["properties"]["status"]=="working-base-modern-coast-not-final"
    all_rings=modern["geometry"]["coordinates"]
    reference=max(all_rings,key=lambda item:len(item[0]))[0]
    length=sum(seglen_m(a,b) for a,b in zip(lonlat,lonlat[1:]))
    sample_values=[]
    for index,(a,b) in enumerate(zip(lonlat,lonlat[1:])):
        css_len=math.hypot((a[0]-b[0])*CSS_PER_DEG,(a[1]-b[1])*CSS_PER_DEG)
        samples=max(1,math.ceil(css_len/0.08))
        for j in range(samples+1):
            t=j/samples
            p=[a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t]
            sample_values.append({"fromVertexSegment":index,
                                  "interpolationT":round(t,5),
                                  "pointLonLat":[round(p[0],9),round(p[1],9)],
                                  "nearestModernCssPx":nearest_px(p,reference)})
    maxima=max(sample_values,key=lambda x:x["nearestModernCssPx"])
    minima=min(sample_values,key=lambda x:x["nearestModernCssPx"])
    candidate={
      "type":"FeatureCollection","name":"Cecilienkoog 1905 mapped dyke — NON-FINAL",
      "features":[{"type":"Feature","id":"provisional-dyke:deutsches-reich:1914:cecilienkoog-1905",
      "properties":{
        "referenceDate":"1914-07-31",
        "constructionInterval":"1903–1905 (local municipality)",
        "mapSheetEpochGroup":"1902–1930 (exact sheet survey/revision year unverified)",
        "status":"PROVISIONAL_SOURCE_MAP_DYKE_TRACE_ONLY",
        "mappedFeatureType":"seaward-protection-dyke-alignment",
        "notAHistoricalLegalSeaCoast":True,
        "notAHighTideLine":True,
        "isNotCountryPolygon":True,
        "mapSource":raster["officialWms"],
        "mapWmsLayer":raster["layerName"],
        "mapRasterSha256":raster["imageSha256"],
        "mapAttribution":raster["attribution"],
        "chronologyEvidence":source["historicalContext"]["independentChronologySource"],
        "traceSource":str(SRC.relative_to(ROOT)),
        "readOnlyEvidence":True,
        "doNotPromote":True,
      },
      "geometry":{"type":"LineString","coordinates":lonlat}}]
    }
    qa={
      "schemaVersion":1,
      "referenceDate":"1914-07-31",
      "reference":"provisional period-map dyke, NOT authenticated 1914 sea-shoreline",
      "status":"manually-digitized-provisional-dyke",
      "source":str(SRC.relative_to(ROOT)),
      "imageLayerTemporalRange":"1902–1930; exact survey/revision year unknown",
      "sourceMicrotileRunId":raster["sourceRunId"],
      "sourceOriginalRasterSha256":raster["imageSha256"],
      "modernProvisionalWorkingBlobSha":git_blob_sha,
      "traceVertexCount":len(lonlat),
      "traceApproxLengthMetres":round(length,2),
      "screenSpace":{
        "projection":"flat equirectangular WGS84",
        "mapContentWidthCssPx":2560,
        "flatZoom":64,"cssPxPerCoordinateDegree":CSS_PER_DEG,
        "method":"directed dense samples from manual period-map DYKE trace to nearest current interim working-mainland line; includes WMS map provenance but not georegistration accuracy",
        "samplingMaxSegmentStepCssPx":0.08,
        "samplePointCount":len(sample_values),
        "minimumOneWayCssPx":round(minima["nearestModernCssPx"],3),
        "maximumOneWayCssPx":round(maxima["nearestModernCssPx"],3),
        "maximumSampleAt":maxima["pointLonLat"],
        "notFullBidirectionalShorelineHausdorff":True,
        "notMeasured1914ToPresentShorelineDeviation":True
      },
      "historicallyVerified1914Geometry":False,
      "independent1914CoastlineDigitized":False,
      "actuallyDigitizedHistoricalStructure":"period-group 1902–1930 dyke, 1903–1905 independent construction year",
      "individualSheetRevisionDateVerified":False,
      "tideOrWetlandLandClassificationVerified":False,
      "georegistrationErrorMeasured":False,
      "shouldUpdateMasterOrTimeline":False,
      "nextValidation":"Confirm individual WMS sheet revision and georeferencing residual; examine foreshore vs dyke, trace genuine 1914 wet/dry boundary and modern matched shoreline before full Hausdorff."
    }
    write(OUT,candidate,args.check)
    write(QA,qa,args.check)
    print(json.dumps({"mode":"CHECK" if args.check else "BUILD",
                      "traceCount":len(lonlat),
                      "provisionalDykeLengthM":round(length,1),
                      "candidateOneWayMaxCssPx":qa["screenSpace"]["maximumOneWayCssPx"],
                      "isVerified1914Shoreline":False,
                      "sourceRasterHash":raster["imageSha256"],
                      "modernBlobSha":git_blob_sha},ensure_ascii=False))
if __name__=="__main__":
    main()
