#!/usr/bin/env python3
"""Probe official Schleswig-Holstein Prussian map epochs against a *modern* working coast.

This is evidence gathering. Do not infer a 1914 shoreline or edited polygon
from a WMS image's broad 1902-1930 layer label.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

import requests
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import box, shape

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tools/historical-library/sources/german-coastline/sh-wms-period-overlay-probe.json"
PREVIEW = ROOT / "tools/historical-library/review-output/german-coastline-sh-period"
WORKING = ROOT / "tools/historical-library/working/german-empire-1914-base.geojson"
BASE_URL = "https://dienste.gdi-sh.de/WMS_SH_FD_Chronologen"
LAYER_NAMES = {"3": "1878-1880", "2": "1902-1930", "1": "1932-1950"}
MAP_CREDIT = "© GeoBasis-DE/LVermGeo SH/CC BY 4.0"
WMS_VERSION = "1.3.0"
WIDTH, HEIGHT = 1500, 1120
PANELS = [
    {"id": "eider-mouth", "label": "Eider mouth / 1973 barrage", "bbox": [8.795, 54.224, 8.895, 54.304]},
    {"id": "eiderstedt-husum", "label": "Eiderstedt to Husum", "bbox": [8.985, 54.44, 9.095, 54.52]},
    {"id": "hauke-haien-koog", "label": "Hauke-Haien-Koog 1958-1959", "bbox": [8.80, 54.69, 8.92, 54.77]},
    {"id": "beltringharder", "label": "Beltringharder Koog 1987", "bbox": [8.865, 54.52, 8.975, 54.600]},
]
HTTP_TIMEOUT = (18, 70)

def local(tag):
    return tag.rsplit("}", 1)[-1]

def child(node, name):
    return next((c for c in node if local(c.tag) == name), None)

def children(node, name):
    return [c for c in node if local(c.tag) == name]

def text(node, name):
    c = child(node, name)
    return (c.text or "").strip() if c is not None else None

def bbox_from(layer):
    node = child(layer, "EX_GeographicBoundingBox")
    if node is None:
        return None
    try:
        return [float(text(node, "westBoundLongitude")),
                float(text(node, "southBoundLatitude")),
                float(text(node, "eastBoundLongitude")),
                float(text(node, "northBoundLatitude"))]
    except (TypeError, ValueError):
        return None

def intersects(a, b):
    return bool(a and b and a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1])

def map_params(layer, bbox):
    west, south, east, north = bbox
    return {
        "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": WMS_VERSION,
        "LAYERS": layer, "STYLES": "", "CRS": "EPSG:4326",
        "BBOX": f"{south},{west},{north},{east}",  # WMS 1.3 EPSG:4326 axis order
        "WIDTH": str(WIDTH), "HEIGHT": str(HEIGHT),
        "FORMAT": "image/png", "TRANSPARENT": "TRUE",
    }

def font(size):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()

def draw_modern(map_image, coastline, bbox, subtitle):
    west, south, east, north = bbox
    def projected(lon, lat):
        return ((lon - west) / (east - west) * (WIDTH - 1),
                (north - lat) / (north - south) * (HEIGHT - 1))
    base = Image.new("RGBA", (WIDTH, HEIGHT), "white")
    base.alpha_composite(map_image)
    canvas = Image.new("RGB", (WIDTH, HEIGHT + 100), "white")
    canvas.paste(base.convert("RGB"), (0, 40))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle((0, 0, WIDTH, 39), fill=(23, 43, 57))
    draw.text((12, 10), subtitle, fill="white", font=font(17))
    visible = coastline.intersection(box(*bbox))
    if not visible.is_empty:
        contours = ([visible] if visible.geom_type == "LineString" else
                    list(visible.geoms) if visible.geom_type == "MultiLineString" else
                    [g for g in getattr(visible, "geoms", []) if g.geom_type == "LineString"])
        for line in contours:
            pts = [projected(*p) for p in line.coords]
            if len(pts) > 1:
                pts2 = [(x, y + 40) for x, y in pts]
                draw.line(pts2, fill="white", width=7, joint="curve")
                draw.line(pts2, fill=(211, 40, 54), width=3, joint="curve")
    draw.rectangle((0, HEIGHT + 40, WIDTH, HEIGHT + 100), fill=(23, 43, 57))
    draw.text((12, HEIGHT + 48),
              "RED = temporary modern map polygon; NOT authenticated 1914 shoreline.",
              fill="white", font=font(17))
    draw.text((12, HEIGHT + 70), MAP_CREDIT, fill=(191, 225, 239), font=font(16))
    return canvas


def optional_params(layer, bbox, profile):
    from math import radians, log, tan, pi
    params = map_params(layer, bbox)
    w, so, e, no = bbox
    if profile == "wms111_epsg4326":
        params.pop("CRS")
        params["VERSION"] = "1.1.1"
        params["SRS"] = "EPSG:4326"
        params["BBOX"] = f"{w},{so},{e},{no}"
    elif profile == "wms130_crs84":
        params["CRS"] = "CRS:84"
        params["BBOX"] = f"{w},{so},{e},{no}"
    elif profile == "wms130_epsg3857":
        earth = 6378137.0
        merc_y = lambda lat: earth*log(tan(pi/4 + radians(lat)/2))
        params["CRS"] = "EPSG:3857"
        params["BBOX"] = f"{earth*radians(w)},{merc_y(so)},{earth*radians(e)},{merc_y(no)}"
    elif profile == "wms130_lonlat_diagnostic":
        params["CRS"] = "EPSG:4326"
        params["BBOX"] = f"{w},{so},{e},{no}"
    elif profile == "wms130_epsg4326":
        pass
    else:
        raise ValueError("Unknown profile: "+profile)
    return params

def inspect_map_response(session, layer, bbox, profile):
    params = optional_params(layer, bbox, profile)
    info = {"profile":profile, "bbox":bbox, "layer":layer}
    try:
        rsp = session.get(BASE_URL, params=params, timeout=HTTP_TIMEOUT)
        info["httpStatus"] = rsp.status_code
        info["contentType"] = rsp.headers.get("Content-Type")
        info["bytes"] = len(rsp.content)
        info["url"] = rsp.url
        rsp.raise_for_status()
        if not info["contentType"] or not info["contentType"].lower().startswith("image/"):
            raise ValueError("Not image: "+rsp.text[:140])
        image = Image.open(io.BytesIO(rsp.content)).convert("RGBA")
        alpha = image.getchannel("A")
        hist = alpha.histogram()
        nonzero = sum(hist[1:])
        info["rgbaDimensions"] = list(image.size)
        info["alphaNonzeroFraction"] = round(nonzero/(image.width*image.height),6)
        info["alphaExtrema"] = list(alpha.getextrema())
        sample = image.resize((100,75))
        informative = 0
        for red,green,blue,a in sample.getdata():
            if a > 15 and min(red,green,blue) < 245:
                informative += 1
        info["coloredSampleFraction"] = round(informative/(100*75),6)
        info["nonblank"] = bool(nonzero > 0 and informative >= 80)
    except Exception as exc:
        info["error"] = type(exc).__name__ + ": "+str(exc)[:260]
        info["nonblank"] = False
    return info

def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.mkdir(parents=True, exist_ok=True)
    feature = json.loads(WORKING.read_text(encoding="utf-8"))["features"][0]
    assert feature["properties"]["referenceDate"] == "1914-07-31"
    assert "not-final" in feature["properties"]["status"]
    multipolygon = shape(feature["geometry"])
    mainland = max(multipolygon.geoms, key=lambda x: x.area)
    coastline = mainland.exterior
    session = requests.Session()
    session.headers.update({"User-Agent": "Pando-GIS-1914-period-map-source-review/1.0"})
    report = {
        "schemaVersion": 1, "asOf": "2026-10-09",
        "referenceDate": "1914-07-31",
        "service": BASE_URL, "serviceLicenseCredit": MAP_CREDIT,
        "source": "https://www.govdata.de/suche/daten/preussische-landesaufnahme-bis-1950-chronologen",
        "modernWorkingGeometry": str(WORKING.relative_to(ROOT)),
        "mapProjection": "WMS 1.3.0 EPSG:4326 axis-ordered request",
        "status": "source-probe", "independent1914ShorelineDigitized": False,
        "actual1914PixelDisplacementMeasured": False,
        "historicOverlayStopThresholdPassed": None,
        "warnings": [
            "WMS Chronologen layers are period RANGE groupings: layer 2 1902-1930 can contain post-1914 maps. Survey and revision years are NOT established per pixel.",
            "A mapped dike or defended tidal basin is not automatically a dry-land sea edge.",
            "Red line is website-derived modern generalized working data and does not establish historical accuracy.",
            "Raster overlay is only an independent source VISUALIZATION. No historical coastline is digitized or changed.",
        ],
        "panels": []
    }
    try:
        r = session.get(BASE_URL, params={"SERVICE":"WMS","REQUEST":"GetCapabilities","VERSION":WMS_VERSION},timeout=HTTP_TIMEOUT)
        r.raise_for_status()
        root = ET.fromstring(r.content)
        parent = child(child(root, "Capability"), "Layer")
        assert parent is not None, "No WMS root layer"
        layers = []
        def visit(node, inherited=None):
            bounds = bbox_from(node) or inherited
            n = text(node, "Name")
            if n:
                layers.append({"name": n, "title": text(node,"Title"), "extentLonLat": bounds})
            for sub in children(node, "Layer"):
                visit(sub, bounds)
        visit(parent)
        report["serviceCapabilities"] = {
            "httpStatus": r.status_code, "bytes": len(r.content),
            "sha256": hashlib.sha256(r.content).hexdigest(),
            "rootExtentLonLat": bbox_from(parent), "layers": layers,
        }
    except Exception as exc:
        report["status"]="service-capabilities-unavailable"
        report["capabilitiesError"]=f"{type(exc).__name__}: {str(exc)[:350]}"
        OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        print(json.dumps({"result":report["status"],"error":report["capabilitiesError"]}))
        return
    by_name = {x["name"]: x for x in layers}
    diagnostic_site = [8.98,54.435,9.10,54.52]  # Husum: inland SH, non-coastal control
    profiles = ["wms130_epsg4326", "wms111_epsg4326",
                "wms130_crs84", "wms130_epsg3857", "wms130_lonlat_diagnostic"]
    sample_results = [inspect_map_response(session,"2", diagnostic_site,p) for p in profiles]
    report["getMapProfilePreflight"] = sample_results
    working_profile = next((x["profile"] for x in sample_results if x["nonblank"]),None)
    report["workingGetMapProfile"] = working_profile
    for panel in PANELS:
        info = dict(panel)
        info["layerImages"] = []
        for lyr in ("3", "2"):
            result = {
                "layerName": lyr,
                "declaredRange": LAYER_NAMES[lyr],
                "serviceLayerMetadata": by_name.get(lyr),
                "bboxInsideLayerExtent": intersects(by_name.get(lyr,{}).get("extentLonLat"), panel["bbox"]),
                "actualSurveyOrRevisionYearVerified": False,
                "independentShorelineVectorDigitized": False,
                "historic1914ToCurrentCssPx": None,
            }
            if not result["bboxInsideLayerExtent"]:
                result["fetchStatus"] = "not-requested-outside-advertised-extent"
                info["layerImages"].append(result)
                continue
            if not working_profile:
                result["fetchStatus"] = "skipped-no-working-GetMap-profile"
                info["layerImages"].append(result)
                continue
            params = optional_params(lyr, panel["bbox"], working_profile)
            result["GetMapProfile"] = working_profile
            try:
                rsp = session.get(BASE_URL, params=params, timeout=HTTP_TIMEOUT)
                result["httpStatus"] = rsp.status_code
                result["mimeType"] = rsp.headers.get("Content-Type")
                rsp.raise_for_status()
                if not rsp.headers.get("Content-Type","").lower().startswith("image/"):
                    raise ValueError("GetMap did not return an image: " + rsp.text[:180])
                source_png = Image.open(io.BytesIO(rsp.content)).convert("RGBA")
                source_png.load()
                if source_png.size != (WIDTH, HEIGHT):
                    raise ValueError(f"Unexpected output dimensions {source_png.size}")
                result["downloadBytes"] = len(rsp.content)
                result["sha256"] = hashlib.sha256(rsp.content).hexdigest()
                alpha_bbox = source_png.getchannel("A").getbbox()
                if alpha_bbox is None:
                    raise ValueError("Response is entirely transparent / no map coverage")
                orig_name = panel["id"]+"-"+lyr+"-original.png"
                source_png.save(PREVIEW/orig_name)
                canvas = draw_modern(
                    source_png, coastline, panel["bbox"],
                    panel["label"] + " | map layer "+LAYER_NAMES[lyr]+" (SHEET DATE UNVERIFIED)")
                preview_name = panel["id"]+"-"+lyr+"-overlay.jpg"
                canvas.save(PREVIEW/preview_name,format="JPEG",quality=81,optimize=True)
                result.update({"fetchStatus":"image-rendered","sourceImage":orig_name,
                               "overlayImage":preview_name,"pixelDimensions":[WIDTH,HEIGHT]})
                if os.environ.get("GIS_COAST_LOG_THUMBNAILS") == "1":
                    thumb = canvas.copy()
                    thumb.thumbnail((880, 720))
                    buf=io.BytesIO()
                    thumb.save(buf,format="JPEG",quality=58,optimize=True)
                    print("===BEGIN_"+panel["id"].upper().replace("-","_")+"_"+lyr+"_JPEG===")
                    print(base64.b64encode(buf.getvalue()).decode("ascii"))
                    print("===END_"+panel["id"].upper().replace("-","_")+"_"+lyr+"_JPEG===")
            except Exception as exc:
                result.update({"fetchStatus":"error",
                               "error":f"{type(exc).__name__}: {str(exc)[:320]}"})
            info["layerImages"].append(result)
        report["panels"].append(info)
    successes=sum(r["fetchStatus"]=="image-rendered" for p in report["panels"] for r in p["layerImages"])
    report["status"]="source-overlays-rendered" if successes else "service-read-map-unavailable"
    report["successfulLayerImages"] = successes
    report["ciRunId"] = os.environ.get("GITHUB_RUN_ID")
    OUT.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("===GIS_COAST_SUMMARY_JSON===")
    print(json.dumps({"status":report["status"],"run":report["ciRunId"],
                      "successfulImages":successes,
                      "panels":[{"name":p["id"],"results":[x["fetchStatus"] for x in p["layerImages"]]} for p in report["panels"]]},
                      ensure_ascii=False))
    print("===END_GIS_COAST_SUMMARY_JSON===")

if __name__=="__main__":
    main()
