#!/usr/bin/env python3
"""Independent Landsat C2 L2 *pixel* preflight for Baikonur treaty banks.

The original USGS pixels, not OSM or government vector lines, are read.
This is NOT a legal shoreline reconstruction, treaty-datum verification,
or permission to replace a published KAB/KAZ polygon.
No SAS token or signed URL is persisted or logged.
"""
import argparse
import json
import os
from pathlib import Path
import sys

import numpy as np
from scipy import ndimage
import requests
import rasterio
from rasterio.windows import from_bounds, Window
from rasterio.warp import transform, transform_bounds

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2"
_TOKEN_CACHE = None
BAD_QA_BITS = sum(1 << bit for bit in (0, 1, 2, 3, 4, 5))
SCALE = 2.75e-5
OFFSET = -0.2


def screen_water(green_dn, nir_dn, quality):
    """Decode raw USGS SR digital numbers (not display RGB)."""
    assert green_dn.shape == nir_dn.shape == quality.shape
    clean = (quality.astype(np.uint16) & BAD_QA_BITS) == 0
    g = green_dn.astype(np.float32) * SCALE + OFFSET
    n = nir_dn.astype(np.float32) * SCALE + OFFSET
    allowed = clean & (green_dn > 0) & (nir_dn > 0) & (g > 0) & (n > 0)
    ndwi = (g - n) / np.maximum(g + n, 1e-6)
    raw = allowed & (ndwi >= 0.1)
    # Remove individual noisy pixels only. Never bridge a river gap or
    # smooth the water edge into a made-up high-confidence legal bank.
    counts = ndimage.label(raw)[0]
    if counts.max():
        areas = np.bincount(counts.ravel())
        water = raw & (areas[counts] >= 3)
    else:
        water = raw
    return water, allowed, ndwi


def search_scenes(bbox, year):
    end = f"{year}-12-31T23:59:59Z"
    response = requests.get(STAC, params={
        "collections": "landsat-c2-l2",
        "bbox": ",".join(f"{x:.7f}" for x in bbox),
        "datetime": f"{year}-01-01T00:00:00Z/{end}",
        "limit": "100",
    }, timeout=35)
    response.raise_for_status()
    data = response.json()
    if data.get("type") != "FeatureCollection":
        raise ValueError("Invalid USGS STAC search result")
    choices = []
    for scene in data["features"]:
        props = scene.get("properties", {})
        if not str(props.get("datetime", "")).startswith(str(year) + "-"):
            continue
        cover = props.get("eo:cloud_cover")
        if not isinstance(cover, (int, float)) or cover > 20:
            continue
        if year < 2000 and not scene.get("id", "").startswith("LT05_"):
            continue
        assets = scene.get("assets", {})
        if not all(assets.get(b, {}).get("href", "").startswith("https://")
                   for b in ("green", "nir08", "qa_pixel")):
            continue
        choices.append(scene)
    choices.sort(key=lambda s: (
        0 if year < 2000 or s.get("id", "").startswith(("LC08_", "LC09_")) else 1,
        s["properties"].get("eo:cloud_cover", 100),
        s["properties"].get("datetime", ""),
    ))
    return choices


def sign_asset(url):
    global _TOKEN_CACHE
    from urllib.parse import urlsplit
    source = urlsplit(url)
    if source.scheme != "https" or not source.hostname.endswith(".blob.core.windows.net"):
        raise ValueError("Untrusted Landsat container")
    if _TOKEN_CACHE is None:
        resp = requests.get(TOKEN, timeout=25)
        resp.raise_for_status()
        token = resp.json().get("token", "")
        if not token or "sig=" not in token:
            raise ValueError("Missing container-scoped ephemeral signature")
        _TOKEN_CACHE = token
    return url + "?" + _TOKEN_CACHE


def raster_window(url, bbox):
    signed = sign_asset(url)
    # GDAL COG reads only required band blocks with HTTPS Range.
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      GDAL_HTTP_MAX_RETRY="1",
                      CPL_VSIL_CURL_USE_HEAD="YES"):
        with rasterio.open(signed) as dataset:
            bounds = transform_bounds("EPSG:4326", dataset.crs, *bbox, densify_pts=21)
            win = from_bounds(*bounds, transform=dataset.transform)
            rounded = win.round_offsets().round_lengths()
            limit = Window(0, 0, dataset.width, dataset.height)
            win = rounded.intersection(limit)
            if win.width < 10 or win.height < 10:
                raise ValueError("Scene does not cover inspected treaty bank")
            if win.width * win.height > 5_000_000:
                raise ValueError("Requested raster subset too large")
            data = dataset.read(1, window=win)
            tx = dataset.window_transform(win)
            crs = str(dataset.crs)
            return data, tx, crs, dataset.res


def inspect_scene(scene, area):
    bands = scene["assets"]
    first, tx, crs, resolution = raster_window(bands["green"]["href"], area["bbox"])
    nir, tx2, crs2, resolution2 = raster_window(bands["nir08"]["href"], area["bbox"])
    qa, tx3, crs3, resolution3 = raster_window(bands["qa_pixel"]["href"], area["bbox"])
    if not (first.shape == nir.shape == qa.shape and crs == crs2 == crs3
            and tx.almost_equals(tx2) and tx.almost_equals(tx3)):
        raise ValueError("Source spectral and QA grids are not co-registered")
    water, clean, ndwi = screen_water(first, nir, qa)
    water_count = int(np.count_nonzero(water))
    clean_fraction = float(np.count_nonzero(clean)) / clean.size
    if clean_fraction < 0.50:
        raise ValueError("Less than half the local treaty window has valid pixels")
    if water_count:
        yy, xx = np.where(water)
        xw = tx.c + (xx + 0.5) * tx.a
        yw = tx.f + (yy + 0.5) * tx.e
        nearest = []
        for coord in (area["start"], area["end"]):
            east, north = transform("EPSG:4326", crs, [coord[0]], [coord[1]])
            d = np.hypot(xw-east[0], yw-north[0])
            nearest.append(round(float(np.min(d)), 1))
    else:
        nearest = [None, None]
    return {
        "sceneId": scene["id"],
        "sceneDate": scene["properties"]["datetime"],
        "sceneCloudPercent": scene["properties"]["eo:cloud_cover"],
        "gridCRS": crs,
        "pixelSizeMeters": [round(float(v), 2) for v in resolution],
        "windowPixels": list(first.shape),
        "usableCloudFreePercent": round(clean_fraction * 100, 2),
        "waterPixelCount": water_count,
        "waterFractionOfCleanPixels": round(water_count / max(1, np.count_nonzero(clean)), 5),
        "nearestWaterPixelToTreatyAnchorsMeters": nearest,
        "waterMaskThreshold": "NDWI>=0.1, raw USGS SR scale/offset and QA_PIXEL cloud/shadow/snow filtering",
        "source": "USGS Landsat C2 L2, independent, OSM-free",
        "status": "PIXEL_OBSERVATION_ONLY_NOT_LEGAL_BOUNDARY",
    }


def run(areas, years=(1994, 2020), attempts=3):
    report = {
        "schema": "pando-baikonur-independent-historic-spectral-preflight-v1",
        "legalBoundaryVerified": False,
        "originalTreatyDatumVerified": False,
        "riverRightBankDigitized": False,
        "publishedGeometryModified": False,
        "osmDataUsed": False,
        "processing": "native USGS C2 L2 30m reflectance; no external vector data",
        "areas": [],
    }
    for area in areas:
        for year in years:
            item = {"pair": area["pair"], "year": year, "examined": [], "errors": []}
            try:
                candidates = search_scenes(area["bbox"], year)
                item["candidateSceneCountOnFirstPage"] = len(candidates)
                for scene in candidates[:attempts]:
                    try:
                        item["examined"].append(inspect_scene(scene, area))
                    except Exception as ex:
                        # Never log an exception containing Azure signed URL/SAS.
                        item["errors"].append({
                            "sceneId": scene["id"], "class": type(ex).__name__,
                            "httpStatus": getattr(getattr(ex, "response", None), "status_code", None),
                            "safeReason": str(ex) if isinstance(ex, ValueError) and
                              str(ex) in (
                                "Untrusted Landsat container",
                                "Missing container-scoped ephemeral signature",
                                "Less than half the local treaty window has valid pixels",
                                "Source spectral and QA grids are not co-registered"
                              ) else "Unavailable",
                            "reason": "COG_WINDOWS_OR_SAS_UNAVAILABLE_NO_GEOMETRY_ASSUMED"})
                item["status"] = "SPECTRAL_PIXELS_OBSERVED" if item["examined"] else "NO_VALID_PIXEL_WINDOW"
            except Exception as ex:
                item["errors"].append({"class": type(ex).__name__,
                                       "reason": "STAC_METADATA_UNAVAILABLE"})
                item["status"] = "NO_VALID_PIXEL_WINDOW"
            report["areas"].append(item)
            print("BAIKONUR_LANDSAT_PIXEL_CHECK=" + json.dumps({
                "pair": area["pair"], "year": year, "status": item["status"],
                "samples": len(item["examined"]), "errorClasses": [e["class"] for e in item["errors"]]
            }), flush=True)
    return report


def test_spectral_logic():
    # Water must be high-green / low NIR after the USGS scale and offset.
    g = np.array([[16000, 9000, 16000, 16000]], dtype=np.uint16)
    n = np.array([[9000, 16000, 9000, 9000]], dtype=np.uint16)
    q = np.array([[0, 0, 1 << 3, 0]], dtype=np.uint16)
    w, v, _ = screen_water(g, n, q)
    assert v.shape == w.shape
    assert v[0, 0] and not v[0, 2]
    assert not w[0, 1]
    print("BAIKONUR_SPECTRAL_SELFTEST_OK", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--treaty-areas")
    parser.add_argument("--output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        test_spectral_logic()
        sys.exit(0)
    if not args.treaty_areas or not args.output:
        parser.error("--treaty-areas and --output required")
    with open(args.treaty_areas, encoding="utf-8") as source:
        areas = json.load(source)["areas"]
    if len(areas) != 2:
        raise ValueError("Require the two official treaty bank windows")
    summary = run(areas)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("x", encoding="utf-8") as dest:
        json.dump(summary, dest, indent=2, ensure_ascii=False)
        dest.write("\n")
