#!/usr/bin/env python3
"""Fetch the pinned source subsets used by the East Germany library recipe.

This command is intentionally separate from the deterministic library build. The
checked-in subsets are the build inputs; refreshing them is an explicit source
maintenance operation because the BKG service is updated annually.
"""

from __future__ import annotations

import json
import pathlib
import urllib.parse
import urllib.request


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "tools" / "historical-library" / "sources" / "east-germany"
NE_ADMIN1_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
    "v5.1.1/geojson/ne_10m_admin_1_states_provinces.geojson"
)
BKG_WFS = "https://sgx.geodatenzentrum.de/wfs_vg250"
BERLIN_WFS = "https://gdi.berlin.de/services/wfs/berlinermauer"
EAST_GERMAN_ADMIN1_IDS = {"DE-BB", "DE-MV", "DE-SN", "DE-ST", "DE-TH", "DE-BE"}


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "PandoLab historical-library builder/1"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def wfs_url(base: str, typename: str, crs: str, cql_filter: str | None = None) -> str:
    query = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": typename,
        "OUTPUTFORMAT": "application/json",
        "SRSNAME": crs,
    }
    if cql_filter:
        query["CQL_FILTER"] = cql_filter
    return f"{base}?{urllib.parse.urlencode(query)}"


def normalized_collection(raw: dict, *, source_crs: str, source_layer: str = "") -> dict:
    features = []
    for feature in raw.get("features", []):
        properties = dict(feature.get("properties") or {})
        if source_layer:
            properties["source_layer"] = source_layer
        features.append(
            {
                "type": "Feature",
                "properties": properties,
                "geometry": feature.get("geometry"),
            }
        )
    return {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": source_crs}},
        "features": features,
    }


def write_json(name: str, payload: dict) -> None:
    path = OUTPUT / name
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)

    natural_earth = fetch_json(NE_ADMIN1_URL)
    selected = [
        feature
        for feature in natural_earth.get("features", [])
        if str((feature.get("properties") or {}).get("iso_3166_2", "")) in EAST_GERMAN_ADMIN1_IDS
    ]
    selected.sort(key=lambda feature: str(feature["properties"]["iso_3166_2"]))
    found = {str(feature["properties"]["iso_3166_2"]) for feature in selected}
    if found != EAST_GERMAN_ADMIN1_IDS:
        raise RuntimeError(f"Natural Earth Admin 1 selection mismatch: {sorted(found)}")
    write_json(
        "natural-earth-admin1-germany-v5.1.1.geojson",
        {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
            "features": selected,
        },
    )

    amt_neuhaus = fetch_json(
        wfs_url(BKG_WFS, "vg250:vg250_gem", "EPSG:25832", "ags='03355049'")
    )
    if len(amt_neuhaus.get("features", [])) != 1:
        raise RuntimeError("BKG VG250 did not return exactly one Amt Neuhaus feature")
    write_json(
        "bkg-vg250-amt-neuhaus-25832.geojson",
        normalized_collection(amt_neuhaus, source_crs="EPSG:25832"),
    )

    berlin_land = fetch_json(wfs_url(BKG_WFS, "vg250:vg250_lan", "EPSG:25833", "ags='11'"))
    if len(berlin_land.get("features", [])) != 1:
        raise RuntimeError("BKG VG250 did not return exactly one Berlin Land feature")
    write_json(
        "bkg-vg250-berlin-land-25833.geojson",
        normalized_collection(berlin_land, source_crs="EPSG:25833"),
    )

    wall_features = []
    for layer in ("a_grenzmauer", "c_politischegrenze"):
        collection = normalized_collection(
            fetch_json(wfs_url(BERLIN_WFS, f"berlinermauer:{layer}", "EPSG:25833")),
            source_crs="EPSG:25833",
            source_layer=layer,
        )
        if not collection["features"]:
            raise RuntimeError(f"Berlin Wall WFS layer is empty: {layer}")
        wall_features.extend(collection["features"])
    wall_features.sort(
        key=lambda feature: (
            str(feature["properties"].get("source_layer", "")),
            json.dumps(feature["geometry"], sort_keys=True, separators=(",", ":")),
        )
    )
    write_json(
        "berlin-wall-1989-25833.geojson",
        {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:25833"}},
            "features": wall_features,
        },
    )


if __name__ == "__main__":
    main()
