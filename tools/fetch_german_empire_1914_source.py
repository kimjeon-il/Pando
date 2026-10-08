#!/usr/bin/env python3
"""Fetch or normalize the local HGIS Germany 1914 state-boundary source.

The HGIS source is intentionally not committed. Automatic WFS access is tried
for convenience; --from-file is the stable fallback when the historical data
service is unavailable.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import tempfile
import urllib.parse
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tools" / "historical-library" / "sources" / "german-empire-1914" / "hgis-germany-states-1914.geojson"
EXPECTED_FEATURES = 26
LAYER = "vector_public:GHGIS1914GERMANY"
CATALOG = "https://geo.nyu.edu/catalog/harvard-ghgis1914germany"
WFS_ENDPOINTS = [
    "https://geodata-proxy.lib.harvard.edu/geoserver/proxy/requestfile/wfs",
    "https://geodata.lib.harvard.edu/vector_public/wfs",
]


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "PandoLab German-Empire-1914 source fetcher/1"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def wfs_url(base: str) -> str:
    query = {
        "service": "WFS",
        "version": "1.0.0",
        "request": "GetFeature",
        "typeName": LAYER,
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
    }
    return f"{base}?{urllib.parse.urlencode(query)}"


def normalize(payload: dict) -> dict:
    if payload.get("type") != "FeatureCollection":
        raise RuntimeError("source is not a GeoJSON FeatureCollection")
    features = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry")
        if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": dict(feature.get("properties") or {}),
                "geometry": geometry,
            }
        )
    if len(features) != EXPECTED_FEATURES:
        raise RuntimeError(
            f"expected {EXPECTED_FEATURES} polygon state features, got {len(features)}"
        )
    return {
        "type": "FeatureCollection",
        "name": "HGIS1914GERMANY-local",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": features,
    }


def load_file(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write(payload: dict) -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(normalize(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size:,} bytes)")
    print("source remains gitignored; review HGIS non-commercial academic-use terms before distribution")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from-file", type=pathlib.Path)
    parser.add_argument("--url")
    args = parser.parse_args()

    if args.from_file:
        write(load_file(args.from_file))
        return
    if args.url:
        write(fetch_json(args.url))
        return

    failures = []
    for endpoint in WFS_ENDPOINTS:
        url = wfs_url(endpoint)
        try:
            write(fetch_json(url))
            print(f"source: {url}")
            return
        except Exception as error:
            failures.append(f"{endpoint}: {error}")

    details = "\n".join(f"- {failure}" for failure in failures)
    raise SystemExit(
        "HGIS WFS download failed. The service has been intermittently unavailable.\n"
        f"{details}\n"
        f"Download 'Germany State Boundaries, 1914' manually from {CATALOG}, convert it to "
        "EPSG:4326 GeoJSON if necessary, then run:\n"
        "  python tools/fetch_german_empire_1914_source.py --from-file PATH_TO_GEOJSON"
    )


if __name__ == "__main__":
    main()
