"""Build the small, self-contained terrain fallback from pinned DEM tiles.

Only DEM LOD 0 and 1 are materialized. Detailed Canvas terrain is derived at
runtime from the same immutable DEM source rather than storing another pyramid.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image, ImageDraw


VERSION = "0.13.3-p2"
FORMAT = "raster-rgba-v1"
LIMIT_BYTES = 32_000_000
TILE_SIZE = 1024
ROOT = Path(__file__).resolve().parents[1]
DEM_MANIFEST = ROOT / "contracts/terrain/preview-dem-source.json"
DEM_INVENTORY = ROOT / "contracts/terrain/preview-dem-inventory.json"
LAND_MASK = ROOT / "assets/data/countries-ne-5.1.1.geojson"
LAND_MASK_SHA256 = "52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encode_webp(pixels: np.ndarray) -> bytes:
    output = io.BytesIO()
    Image.fromarray(pixels, "RGBA").save(output, "WEBP", lossless=True, exact=True, method=6)
    encoded = output.getvalue()
    decoded = np.asarray(Image.open(io.BytesIO(encoded)).convert("RGBA"))
    if not np.array_equal(decoded, pixels):
        raise ValueError("Preview WebP did not preserve RGBA bytes")
    return encoded


def _unwrap_ring(ring):
    if not ring:
        return []
    result = [[float(ring[0][0]), float(ring[0][1])]]
    for lon, lat in ring[1:]:
        lon = float(lon)
        while lon - result[-1][0] > 180:
            lon -= 360
        while lon - result[-1][0] < -180:
            lon += 360
        result.append([lon, float(lat)])
    return result


def rasterize_land_mask(countries: dict, x_origin: int, y_origin: int,
                        tile_width: int, tile_height: int,
                        level_width: int, level_height: int) -> np.ndarray:
    mask = Image.new("L", (tile_width, tile_height), 0)
    draw = ImageDraw.Draw(mask)
    for feature in countries.get("features", []):
        geometry = feature.get("geometry") or {}
        kind = geometry.get("type")
        polygons = [geometry.get("coordinates", [])] if kind == "Polygon" else (
            geometry.get("coordinates", []) if kind == "MultiPolygon" else [])
        for rings in polygons:
            if not rings:
                continue
            unwrapped = [_unwrap_ring(ring) for ring in rings]
            outer_center = sum(point[0] for point in unwrapped[0]) / len(unwrapped[0])
            for ring in unwrapped[1:]:
                if not ring:
                    continue
                shift = round((outer_center - sum(point[0] for point in ring) / len(ring)) / 360) * 360
                for point in ring:
                    point[0] += shift
            for world_shift in (-360, 0, 360):
                outer = [((lon + world_shift + 180) * level_width / 360 - x_origin,
                          (90 - lat) * level_height / 180 - y_origin)
                         for lon, lat in unwrapped[0]]
                if not outer or max(x for x, _ in outer) < -1 or min(x for x, _ in outer) > tile_width or (
                    max(y for _, y in outer) < -1 or min(y for _, y in outer) > tile_height):
                    continue
                draw.polygon(outer, fill=255)
                for ring in unwrapped[1:]:
                    hole = [((lon + world_shift + 180) * level_width / 360 - x_origin,
                             (90 - lat) * level_height / 180 - y_origin)
                            for lon, lat in ring]
                    if hole:
                        draw.polygon(hole, fill=0)
    return np.asarray(mask) > 0


def _sample_tint(tint: np.ndarray, x_origin: int, y_origin: int,
                 tile_width: int, tile_height: int, level_width: int, level_height: int) -> np.ndarray:
    tint_height, tint_width = tint.shape[:2]
    x = np.clip(((np.arange(tile_width, dtype=np.float64) + x_origin + 0.5) % level_width) * tint_width / level_width - 0.5, 0, tint_width-1)
    y = np.clip((np.arange(tile_height, dtype=np.float64) + y_origin + 0.5) * tint_height / level_height - 0.5, 0, tint_height-1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[None, :, None]
    fy = (y - y0)[:, None, None]
    x0 %= tint_width
    x1 = (x0 + 1) % tint_width
    y0 = np.clip(y0, 0, tint_height - 1)
    y1 = np.clip(y0 + 1, 0, tint_height - 1)
    north = tint[y0[:, None], x0[None, :], :3] * (1 - fx) + tint[y0[:, None], x1[None, :], :3] * fx
    south = tint[y1[:, None], x0[None, :], :3] * (1 - fx) + tint[y1[:, None], x1[None, :], :3] * fx
    return north * (1 - fy) + south * fy


def compose_preview_rgba(dem: np.ndarray, tint: np.ndarray, land: np.ndarray,
                         x_origin: int, y_origin: int,
                         level_width: int, level_height: int) -> np.ndarray:
    if dem.ndim != 3 or dem.shape[2] != 4 or not np.all(dem[:, :, 3] == 255):
        raise ValueError("Invalid DEM RGBA tile")
    if land.shape != dem.shape[:2] or tint.ndim != 3 or tint.shape[2] < 3:
        raise ValueError("Invalid tint or land mask")
    height = dem[:, :, 0].astype(np.int32) * 256 + dem[:, :, 1].astype(np.int32) - 12000
    heights = height.astype(np.float64)
    rows, columns = height.shape
    latitude = 90 - (np.arange(rows) + y_origin + 0.5) * 180 / level_height
    east_meters = 40030228.884 * np.maximum(0.0001, np.cos(np.deg2rad(latitude))) / level_width
    north_meters = 20015114.442 / level_height
    # Full-LOD generation wraps longitude before shading, so both tile gutters
    # and the antimeridian reuse exactly the same displayed pixels.
    if x_origin == 0 and columns == level_width:
        east_difference = np.roll(heights, -1, axis=1) - np.roll(heights, 1, axis=1)
    else:
        east_difference = heights[:, np.minimum(np.arange(columns)+1, columns-1)] - heights[:, np.maximum(np.arange(columns)-1, 0)]
    south_difference = heights[np.minimum(np.arange(rows)+1, rows-1), :] - heights[np.maximum(np.arange(rows)-1, 0), :]
    nx = -east_difference / east_meters[:, None]
    ny = south_difference / north_meters
    normal_length = np.sqrt(nx*nx + ny*ny + 1)
    root_half = math.sqrt(0.5)
    illumination = (0.55*np.maximum(0, (-nx*0.5+ny*0.5+root_half)/normal_length)
                    + 0.20*np.maximum(0, (-nx*root_half+root_half)/normal_length)
                    + 0.15*np.maximum(0, (ny*root_half+root_half)/normal_length)
                    + 0.10*np.maximum(0, (-nx*0.5-ny*0.5+root_half)/normal_length))
    polar_illumination = np.maximum(0, (dem[:, :, 2].astype(np.float64)/255 - 0.42)/0.58)
    illumination = np.where((np.abs(latitude) < 89.5)[:, None], illumination, polar_illumination)
    neutral = 0.27 + 0.73*root_half
    shade = np.clip(neutral + ((0.27+0.73*illumination)-neutral)*1.3, 0.16, 1)
    ratio = np.clip(shade / neutral, 0.38, 1.3)
    color = _sample_tint(tint, x_origin, y_origin, dem.shape[1], dem.shape[0], level_width, level_height)
    def smooth(low, high):
        t = np.clip((np.maximum(0, heights)-low)/(high-low), 0, 1)
        return t*t*(3-2*t)
    def blend(first, second, amount):
        return first*(1-amount[:, :, None]) + np.asarray(second)*amount[:, :, None]
    elevation_color = blend(np.array([0.43,0.62,0.39]), [0.68,0.72,0.44], smooth(0,1000))
    elevation_color = blend(elevation_color, [0.72,0.57,0.39], smooth(1000,2500))
    elevation_color = blend(elevation_color, [0.72,0.68,0.62], smooth(2500,4500))
    elevation_color = blend(elevation_color, [0.96,0.95,0.90], smooth(4500,6500))
    color = color*0.4 + elevation_color*(0.6*255)
    depth = np.power(np.clip(-height.astype(np.float64) / 8000, 0, 1), 0.6)
    ocean = np.stack((0.42 + (0.10 - 0.42) * depth,
                      0.66 + (0.24 - 0.66) * depth,
                      0.82 + (0.39 - 0.82) * depth), axis=2) * 255
    color = np.where(land[:, :, None], color, ocean)
    result = np.empty_like(dem)
    result[:, :, :3] = np.rint(np.clip(color * ratio[:, :, None], 0, 255)).astype(np.uint8)
    result[:, :, 3] = np.rint(np.clip((0.58+0.3*smooth(0,6000))*ratio*255, 0, 255)).astype(np.uint8)
    return result


def _source_bytes(path: str, url: str, expected: dict, cache: Path) -> bytes:
    file = cache / path
    if file.exists():
        data = file.read_bytes()
        if len(data) == expected["bytes"] and sha256(data) == expected["sha256"]:
            return data
        raise ValueError(f"Cached DEM source differs from its pin: {path}")
    request = Request(url, headers={"User-Agent": "Pando-terrain-preview-builder/1"})
    with urlopen(request, timeout=60) as response:
        data = response.read()
    if len(data) != expected["bytes"] or sha256(data) != expected["sha256"]:
        raise ValueError(f"Downloaded DEM source differs from its pin: {path}")
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(data)
    return data


def _source_contract() -> tuple[dict, dict, dict]:
    dem = json.loads(DEM_MANIFEST.read_text(encoding="utf-8"))
    inventory = json.loads(DEM_INVENTORY.read_text(encoding="utf-8"))
    country_bytes = LAND_MASK.read_bytes()
    if dem.get("version") != "0.13.3" or dem.get("representation") != "dem-relief-v1" or (
        sha256(country_bytes) != LAND_MASK_SHA256):
        raise ValueError("DEM or land mask pin changed")
    assets = {item["path"]: item for item in inventory["assets"]}
    required = {"terrain/v0.13.3/tint.webp"} | {
        f"terrain/v0.13.0/{level['id']}/{column}-{row}.webp"
        for level in dem["levels"][:2]
        for row in range(level["rows"])
        for column in range(level["columns"])
    }
    if set(assets) != required or len(inventory["assets"]) != len(required) or any(
        not isinstance(item.get("bytes"), int) or item["bytes"] <= 0
        or not isinstance(item.get("sha256"), str) or len(item["sha256"]) != 64
        or any(character not in "0123456789abcdef" for character in item["sha256"])
        for item in assets.values()
    ):
        raise ValueError("Preview DEM source pins are incomplete or invalid")
    if dem["tint"]["sha256"] != assets["terrain/v0.13.3/tint.webp"]["sha256"]:
        raise ValueError("DEM tint pin changed")
    return dem, assets, json.loads(country_bytes)


def _manifest_bytes(manifest: dict) -> bytes:
    return (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build(output: Path, cache: Path) -> dict:
    if output.exists():
        raise FileExistsError(f"Refusing to overwrite preview: {output}")
    dem, assets, countries = _source_contract()
    tint_url = dem["tint"]["url"]
    tint_bytes = _source_bytes("terrain/v0.13.3/tint.webp", tint_url,
                               assets["terrain/v0.13.3/tint.webp"], cache)
    tint = np.asarray(Image.open(io.BytesIO(tint_bytes)).convert("RGB"))
    if tint.shape != (2048, 4096, 3):
        raise ValueError("DEM tint dimensions changed")
    pending = []
    checksums = {}
    for level in dem["levels"][:2]:
        # Rasterize once for the complete LOD. Tile-local polygon clipping can
        # round a negative edge differently from its neighboring positive edge.
        world_land = rasterize_land_mask(countries, 0, 0, level["width"], level["height"],
                                         level["width"], level["height"])
        world_dem = np.empty((level["height"], level["width"], 4), dtype=np.uint8)
        for row in range(level["rows"]):
            for column in range(level["columns"]):
                source_path = f"terrain/v0.13.0/{level['id']}/{column}-{row}.webp"
                url = dem["urlTemplate"].format(level=level["id"], column=column, row=row)
                encoded = _source_bytes(source_path, url, assets[source_path], cache)
                pixels = np.asarray(Image.open(io.BytesIO(encoded)).convert("RGBA"))
                width = min(TILE_SIZE, level["width"] - column * TILE_SIZE) + 2
                height = min(TILE_SIZE, level["height"] - row * TILE_SIZE) + 2
                if pixels.shape != (height, width, 4):
                    raise ValueError(f"DEM tile dimensions changed: {source_path}")
                world_dem[row*TILE_SIZE:row*TILE_SIZE+height-2, column*TILE_SIZE:column*TILE_SIZE+width-2] = pixels[1:-1, 1:-1]
        world_preview = compose_preview_rgba(world_dem, tint, world_land, 0, 0, level["width"], level["height"])
        padded_preview = np.pad(world_preview, ((1, 1), (1, 1), (0, 0)), mode="edge")
        padded_preview[:, 0] = padded_preview[:, -2]
        padded_preview[:, -1] = padded_preview[:, 1]
        for row in range(level["rows"]):
            for column in range(level["columns"]):
                width = min(TILE_SIZE, level["width"]-column*TILE_SIZE)+2
                height = min(TILE_SIZE, level["height"]-row*TILE_SIZE)+2
                tile = padded_preview[row*TILE_SIZE:row*TILE_SIZE+height, column*TILE_SIZE:column*TILE_SIZE+width]
                data = encode_webp(tile)
                target = f"{level['id']}/{column}-{row}.webp"
                pending.append((target, data))
                checksums[target] = {"bytes": len(data), "sha256": sha256(data)}
    tile_bytes = sum(len(data) for _, data in pending)
    if tile_bytes > LIMIT_BYTES:
        raise ValueError(f"Preview exceeds {LIMIT_BYTES} bytes: {tile_bytes}")
    digest = hashlib.sha256()
    for path, data in pending:
        digest.update(path.encode("utf-8") + b"\0" + bytes.fromhex(sha256(data)))
    manifest = {
        "version": VERSION, "representation": FORMAT,
        "dataset": "ETOPO 2022 DEM derived preview",
        "crs": "EPSG:4326", "extent": [-180, -90, 180, 90],
        "tileFormat": "lossless WebP RGBA", "gutter": 1,
        "channels": {"rgb": "elevation-tinted land or bathymetry with multidirectional relief",
                     "alpha": "elevation grayscale with multidirectional relief, not opacity"},
        "displayColors": {"oceanRepresentative": "#6aa8d2"},
        "levels": dem["levels"][:2],
        "urlTemplate": f"terrain-preview/v{VERSION}/{{level}}/{{column}}-{{row}}.webp",
        "sourceDem": {"version": dem["version"], "assetsSha256": dem["assetsSha256"],
                      "tintSha256": dem["tint"]["sha256"], "landMaskSha256": LAND_MASK_SHA256},
        "assetsSha256": digest.hexdigest(), "tiles": checksums,
    }
    output.mkdir(parents=True)
    for path, data in pending:
        target = output / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    (output / "manifest.json").write_bytes(_manifest_bytes(manifest))
    verify(output)
    return {"tiles": len(pending), "tileBytes": tile_bytes,
            "totalBytes": tile_bytes + len(_manifest_bytes(manifest)),
            "manifestSha256": sha256(_manifest_bytes(manifest))}


def verify(output: Path) -> dict:
    dem, _, _ = _source_contract()
    manifest_path = output / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest_bytes != _manifest_bytes(manifest) or manifest.get("version") != VERSION or (
        manifest.get("sourceDem", {}).get("assetsSha256") != dem["assetsSha256"] or
        manifest.get("sourceDem", {}).get("tintSha256") != dem["tint"]["sha256"] or
        manifest.get("sourceDem", {}).get("landMaskSha256") != LAND_MASK_SHA256):
        raise ValueError("Preview manifest identity differs from pinned source")
    expected = {f"{level['id']}/{column}-{row}.webp" for level in dem["levels"][:2]
                for row in range(level["rows"]) for column in range(level["columns"])}
    if set(manifest["tiles"]) != expected or len(expected) != 8:
        raise ValueError("Preview tile inventory incomplete")
    actual = {str(path.relative_to(output)).replace("\\", "/") for path in output.rglob("*") if path.is_file()}
    if actual != expected | {"manifest.json"}:
        raise ValueError("Unexpected preview output files")
    total = 0
    decoded = {}
    digest = hashlib.sha256()
    def tile_order(path: str):
        level, tile = path.removesuffix(".webp").split("/")
        column, row = tile.split("-")
        return int(level), int(row), int(column)
    for path in sorted(expected, key=tile_order):
        data = (output / path).read_bytes()
        if len(data) != manifest["tiles"][path]["bytes"] or sha256(data) != manifest["tiles"][path]["sha256"]:
            raise ValueError(f"Preview tile hash differs: {path}")
        total += len(data)
        decoded[path] = np.asarray(Image.open(io.BytesIO(data)).convert("RGBA"))
        digest.update(path.encode("utf-8") + b"\0" + bytes.fromhex(sha256(data)))
    for level in dem["levels"][:2]:
        for row in range(level["rows"]):
            for column in range(level["columns"]):
                path = f"{level['id']}/{column}-{row}.webp"
                pixels = decoded[path]
                expected_width = min(TILE_SIZE, level["width"] - column * TILE_SIZE) + 2
                expected_height = min(TILE_SIZE, level["height"] - row * TILE_SIZE) + 2
                if pixels.shape != (expected_height, expected_width, 4):
                    raise ValueError(f"Preview tile dimensions or gutter differ: {path}")
                next_tile = decoded[f"{level['id']}/{(column + 1) % level['columns']}-{row}.webp"]
                if not np.array_equal(pixels[:, -1], next_tile[:, 1]) or not np.array_equal(pixels[:, -2], next_tile[:, 0]):
                    raise ValueError(f"Preview horizontal gutter or antimeridian differs: {path}")
                if row + 1 < level["rows"]:
                    south = decoded[f"{level['id']}/{column}-{row + 1}.webp"]
                    if not np.array_equal(pixels[-1], south[1]) or not np.array_equal(pixels[-2], south[0]):
                        raise ValueError(f"Preview vertical gutter differs: {path}")
    if digest.hexdigest() != manifest["assetsSha256"] or total + len(manifest_bytes) > LIMIT_BYTES:
        raise ValueError("Preview aggregate hash or size differs")
    return {"tiles": len(expected), "tileBytes": total,
            "totalBytes": total + len(manifest_bytes), "manifestSha256": sha256(manifest_bytes)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / f"assets/data/terrain-preview/v{VERSION}")
    parser.add_argument("--cache", type=Path, default=ROOT / ".terrain-preview-cache/source")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--rebuild-check", action="store_true")
    options = parser.parse_args()
    if options.rebuild_check:
        result = verify(options.output)
        with tempfile.TemporaryDirectory(prefix="pando-terrain-preview-") as temporary:
            rebuilt = build(Path(temporary) / "preview", options.cache)
            if rebuilt != result:
                raise ValueError("Rebuilt preview differs from committed bytes")
        result["reproducible"] = True
    else:
        if options.check:
            result = verify(options.output)
        else:
            from library_data import library_output
            with library_output([options.output]):
                result = build(options.output, options.cache)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
