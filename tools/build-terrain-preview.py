"""Build the small, self-contained terrain fallback from pinned DEM tiles.

Only DEM LOD 0 and 1 are materialized. Detailed Canvas terrain is derived at
runtime from the same immutable DEM source rather than storing another pyramid.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import struct
import subprocess
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
from PIL import Image


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


def rasterize_land_mask(countries: dict, x_origin: int, y_origin: int,
                        tile_width: int, tile_height: int,
                        level_width: int, level_height: int) -> np.ndarray:
    binary = os.environ.get('PANDO_TERRAIN_PREVIEW_BINARY')
    if not binary:
        raise RuntimeError('PANDO_TERRAIN_PREVIEW_BINARY is required for terrain preview generation')
    payload = json.dumps(dict(countries=countries, x=x_origin, y=y_origin, width=tile_width, height=tile_height,
                              levelWidth=level_width, levelHeight=level_height), ensure_ascii=False).encode('utf-8')
    result = subprocess.run([binary, 'mask'], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=180).stdout
    if len(result) != tile_width * tile_height or any(value > 1 for value in result):
        raise ValueError('Invalid native terrain land mask')
    return np.frombuffer(result, dtype=np.uint8).reshape(tile_height, tile_width).astype(bool)


def compose_preview_rgba(dem: np.ndarray, tint: np.ndarray, land: np.ndarray,
                         x_origin: int, y_origin: int,
                         level_width: int, level_height: int) -> np.ndarray:
    if dem.ndim != 3 or dem.shape[2] != 4 or dem.dtype != np.uint8 or not np.all(dem[:, :, 3] == 255):
        raise ValueError("Invalid DEM RGBA tile")
    if land.shape != dem.shape[:2] or tint.ndim != 3 or tint.shape[2] < 3 or tint.dtype != np.uint8:
        raise ValueError("Invalid tint or land mask")
    rows, columns = dem.shape[:2]
    binary = os.environ.get('PANDO_TERRAIN_PREVIEW_BINARY')
    if not binary:
        raise RuntimeError('PANDO_TERRAIN_PREVIEW_BINARY is required for terrain preview generation')
    header = struct.pack('<8sIIII4d', b'PDTERR01', columns, rows, tint.shape[1], tint.shape[0],
                         x_origin, y_origin, level_width, level_height)
    payload = header + np.ascontiguousarray(dem).tobytes() + np.ascontiguousarray(tint[:, :, :3]).tobytes() + np.ascontiguousarray(land != 0, dtype=np.uint8).tobytes()
    result = subprocess.run([binary], input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=180).stdout
    if len(result) != rows * columns * 4:
        raise ValueError('Invalid native terrain preview output length')
    return np.frombuffer(result, dtype=np.uint8).reshape(rows, columns, 4).copy()


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
