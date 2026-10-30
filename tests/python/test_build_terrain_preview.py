"""Focused contracts for the DEM-derived, independently usable preview."""

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image


SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "build-terrain-preview.py"
spec = importlib.util.spec_from_file_location("build_terrain_preview", SCRIPT)
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class TerrainPreviewTests(unittest.TestCase):
    def test_preview_requires_native_compositor(self):
        dem = np.full((1, 1, 4), 255, dtype=np.uint8)
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'PANDO_TERRAIN_PREVIEW_BINARY'):
                preview.compose_preview_rgba(dem, np.zeros((1,1,3), dtype=np.uint8), np.ones((1,1), dtype=bool), 0, 0, 1, 1)

    def test_land_mask_requires_native_rasterizer(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'PANDO_TERRAIN_PREVIEW_BINARY'):
                preview.rasterize_land_mask({'type':'FeatureCollection','features':[]}, 0, 0, 1, 1, 1, 1)

    def test_selected_elevation_colors_and_gray_match_the_display_contract(self):
        contract = json.loads((SCRIPT.parents[1] / 'tests/fixtures/terrain-presentation.json').read_text())
        tint = np.array([[contract['tint']]], dtype=np.uint8)
        for row in contract['flatLand']:
            source = np.empty((3, 3, 4), dtype=np.uint8)
            encoded = row['height'] + 12000
            source[:] = [encoded >> 8, encoded & 255, 212, 255]
            original = source.copy()
            actual = preview.compose_preview_rgba(source, tint, np.ones((3, 3), dtype=bool), 674, 336, 1350, 675)
            self.assertEqual(actual[1, 1].tolist(), row['rgb'] + [row['gray']], str(row['height']))
            np.testing.assert_array_equal(source, original)

    def test_source_contract_uses_only_required_dem_and_tint_pins(self):
        countries = b'{"type":"FeatureCollection","features":[]}'
        tint_hash = preview.sha256(b"tint")
        dem = {"version": "0.13.3", "representation": "dem-relief-v1",
               "levels": [{"id": 0, "rows": 1, "columns": 1}, {"id": 1, "rows": 1, "columns": 1}],
               "tint": {"sha256": tint_hash}}
        pins = {"assets": [{"path": path, "bytes": 4, "sha256": tint_hash} for path in [
            "terrain/v0.13.0/0/0-0.webp", "terrain/v0.13.0/1/0-0.webp", "terrain/v0.13.3/tint.webp"]]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, inventory, land = root / "source.json", root / "pins.json", root / "land.json"
            source.write_text(json.dumps(dem), encoding="utf-8")
            inventory.write_text(json.dumps(pins), encoding="utf-8")
            land.write_bytes(countries)
            with patch.multiple(preview, DEM_MANIFEST=source, DEM_INVENTORY=inventory,
                                LAND_MASK=land, LAND_MASK_SHA256=preview.sha256(countries)):
                _, assets, actual_countries = preview._source_contract()
                self.assertEqual(len(assets), 3)
                self.assertEqual(actual_countries["features"], [])
                pins["assets"].append(pins["assets"][0])
                inventory.write_text(json.dumps(pins), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "source pins"):
                    preview._source_contract()
                pins["assets"].pop()
                pins["assets"][-1]["sha256"] = "0" * 64
                inventory.write_text(json.dumps(pins), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "tint pin"):
                    preview._source_contract()

    def test_cached_source_keeps_byte_and_hash_verification_without_download(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            data = b"tiny DEM source"
            (cache / "tile.webp").write_bytes(data)
            pin = {"bytes": len(data), "sha256": preview.sha256(data)}
            self.assertEqual(preview._source_bytes("tile.webp", "https://unused.invalid", pin, cache), data)
            (cache / "tile.webp").write_bytes(b"x" * len(data))
            with self.assertRaisesRegex(ValueError, "Cached DEM source differs"):
                preview._source_bytes("tile.webp", "https://unused.invalid", pin, cache)

    def test_dem_color_and_gray_alpha_use_elevation_and_tint(self):
        source = np.zeros((2, 2, 4), dtype=np.uint8)
        source[:, :, 3] = 255
        source[:, :, 2] = 128
        source[:, :, 0] = 12000 // 256
        source[:, :, 1] = 12000 % 256
        below_sea = 8000
        source[0, 1, 0] = below_sea // 256
        source[0, 1, 1] = below_sea % 256
        tint = np.full((2, 2, 3), [100, 150, 200], dtype=np.uint8)
        land = np.array([[True, False], [True, True]])

        actual = preview.compose_preview_rgba(source, tint, land, 0, 0, 2, 2)

        self.assertEqual(actual.shape, (2, 2, 4))
        np.testing.assert_allclose(actual[0, 0], [106,155,140,148], atol=1)
        np.testing.assert_allclose(actual[0, 1], [53,98,137,148], atol=1)

    def test_preview_and_canvas_agree_on_slopes_coasts_and_polar_fallback(self):
        node = r"""
const fs=require('fs'),vm=require('vm'),scope={self:{}};
vm.runInNewContext(fs.readFileSync('shared/frontend/js/workers/canvas-terrain-dem-core.js','utf8'),scope);
const options=JSON.parse(fs.readFileSync(0,'utf8'));
const result=scope.self.PandoLabCanvasTerrainDem.convertTile(options);
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([key,value])=>[key,Array.from(value)]))));
"""
        width = height = 7
        grid_y, grid_x = np.indices((height, width))
        heights = 1200 + 75*(grid_x-3) + 40*(grid_y-3) + 9*(grid_x-3)**2
        encoded = heights + 12000
        dem = np.stack((encoded//256, encoded%256, np.full_like(encoded,128), np.full_like(encoded,255)),axis=2).astype(np.uint8)
        tint = np.array([[[200,100,50,255],[50,150,100,255]],[[80,120,200,255],[220,200,120,255]]],dtype=np.uint8)
        land = (grid_x+grid_y)%2 == 0
        level_width, level_height = 400302.28884, 200151.14442
        for latitude in [0,45,89.6,-89.6]:
            x_origin = level_width/2-3.5
            y_origin = (90-latitude)*level_height/180-3.5
            west = -180+(x_origin+1)*360/level_width
            north = 90-(y_origin+1)*180/level_height
            options = dict(dem=dem.ravel().tolist(),width=width,height=height,tint=tint.ravel().tolist(),tintWidth=2,tintHeight=2,
                           bounds=[west,north,west+5*360/level_width,north-5*180/level_height],pixelWidth=5,pixelHeight=5,
                           levelWidth=level_width,levelHeight=level_height)
            cpu = json.loads(subprocess.check_output(['node','-e',node],input=json.dumps(options),text=True,cwd=SCRIPT.parents[1]))
            actual = preview.compose_preview_rgba(dem,tint,land,x_origin,y_origin,level_width,level_height)
            rgb = np.where(land[:,:,None],np.array(cpu['land']).reshape(height,width,4),np.array(cpu['ocean']).reshape(height,width,4))
            rgb[:,:,3] = np.array(cpu['political']).reshape(height,width,4)[:,:,0]
            self.assertLessEqual(np.max(np.abs(actual.astype(int)-rgb)),2,str(latitude))

    def test_land_mask_hole_and_dateline_are_preserved(self):
        countries = {"type": "FeatureCollection", "features": [{"type": "Feature", "geometry": {
            "type": "Polygon", "coordinates": [
                [[170, 20], [-170, 20], [-170, -20], [170, -20], [170, 20]],
                [[175, 10], [175, -10], [-175, -10], [-175, 10], [175, 10]],
            ]}}]}
        mask = preview.rasterize_land_mask(countries, 0, 0, 360, 180, 360, 180)
        self.assertEqual(mask.shape, (180, 360))
        self.assertTrue(mask[90, 351])
        self.assertFalse(mask[90, 359])
        self.assertTrue(mask[90, 7])
        self.assertFalse(mask[90, 180])

    def test_lossless_preview_preserves_gray_alpha(self):
        pixels = np.zeros((3, 4, 4), dtype=np.uint8)
        pixels[:, :, :3] = [100, 150, 200]
        pixels[:, :, 3] = [[0, 4, 128, 255], [32, 64, 96, 127], [250, 255, 20, 30]]
        encoded = preview.encode_webp(pixels)
        decoded = np.asarray(Image.open(__import__("io").BytesIO(encoded)).convert("RGBA"))
        np.testing.assert_array_equal(decoded, pixels)


if __name__ == "__main__":
    unittest.main()
