from __future__ import annotations

import json
import unittest
from pathlib import Path

from pyproj import Geod, Transformer
from shapely.geometry import Point, box, shape
from shapely.ops import transform, unary_union


ROOT = Path(__file__).parents[1]
PILOT_PATH = ROOT / "assets/data/territorial-entities/source/countries/state-deutsche-demokratische-republik.json"
COUNTRIES_PATH = ROOT / "assets/data/territorial-entities/source/countries/state-DEU.json"
PILOT = json.loads(PILOT_PATH.read_text(encoding="utf-8"))
COUNTRIES = json.loads(COUNTRIES_PATH.read_text(encoding="utf-8"))
ENTITY = PILOT
GEOMETRY = shape(ENTITY["geometryVersions"][0]["geometry"])
CANONICAL_DEU = shape(next(item["geometry"] for item in COUNTRIES["geometryVersions"] if item["datePrecision"] == "current"))
RECIPE = json.loads((ROOT / "tools/historical-library/east-germany-1989.recipe.json").read_text(encoding="utf-8"))
VG25_OPERATION = next(operation for operation in RECIPE["operations"] if operation["id"] == "gdr-vg25-inter-german")
LSIB_OPERATION = next(operation for operation in RECIPE["operations"] if operation["id"] == "gdr-lsib-exterior")
MAP_SECTION_IDS = {"vg25-delvenau-approved-map", "tk25as-elbe-neuhaus-printed-claim", "tk25as-elbe-schnackenburg-printed-claim"}
MAP_SECTIONS = [section for section in RECIPE["boundarySupplement"]["sections"] if section["id"] in MAP_SECTION_IDS]
MAP_REGION = unary_union([box(*section["bounds"]) for section in MAP_SECTIONS])
PREVIOUS = shape(json.loads((ROOT / RECIPE["sources"]["previousDdr"]["path"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
TO_EQUAL_AREA = Transformer.from_crs(4326, 3035, always_xy=True).transform
NORTHERN_SECTION_IDS = {"vg25-ratzeburg-wakenitz-south", "vg25-kiekbusch-mechower-west-shore"}
NORTHERN_SECTIONS = [section for section in VG25_OPERATION["sections"]
                     if section["id"] in NORTHERN_SECTION_IDS]
NORTHERN_REGION = unary_union([box(*section["bounds"]) for section in NORTHERN_SECTIONS])
REMAINING_SECTION_IDS = {
    "vg25-wakenitz-palingen-remaining", "vg25-schaalsee-northern-remaining",
    "vg25-gudow-lauenburg-land", "vg25-altmark-diesdorf-land", "vg25-altmark-stresow-land",
    "vg25-helmstedt-lappwald-land", "vg25-ecker-lower-foothills",
    "vg25-suedharz-ellrich-land", "vg25-rhon-point-alpha-land",
}
REMAINING_SECTIONS = [section for section in VG25_OPERATION["sections"]
                      if section["id"] in REMAINING_SECTION_IDS]
REMAINING_REGION = unary_union([box(*section["bounds"]) for section in REMAINING_SECTIONS])


def projected_area_km2(geometry):
    return abs(transform(TO_EQUAL_AREA, geometry).area) / 1_000_000


class EastGermanyHistoricalLibraryTests(unittest.TestCase):
    def test_identity_dates_aliases_and_instantiation_policy(self):
        self.assertEqual(ENTITY["names"]["en"], "German Democratic Republic")
        self.assertEqual(ENTITY["names"]["ko"], "독일 민주공화국")
        self.assertEqual(ENTITY["names"]["de"], "Deutsche Demokratische Republik")
        self.assertEqual(set(ENTITY["alternateNames"]), {"동독", "East Germany", "DDR", "GDR", "Ostdeutschland"})
        self.assertEqual(ENTITY["lifetime"]["validFrom"], "1949-10-07")
        self.assertEqual(ENTITY["lifetime"]["validTo"], "1990-10-02")
        self.assertEqual(ENTITY["metadata"]["dissolutionDate"], "1990-10-03")
        self.assertEqual(ENTITY["metadata"]["referenceDate"], "1989-04-25")
        self.assertEqual(ENTITY["instantiation"], {
            "mode": "territory-replacement",
            "countryUpdates": {"DEU": {"name": "독일 연방공화국"}},
        })

    def test_geometry_is_valid_bounded_and_inside_canonical_germany(self):
        self.assertEqual(GEOMETRY.geom_type, "MultiPolygon")
        self.assertTrue(GEOMETRY.is_valid)
        area, _ = Geod(ellps="WGS84").geometry_area_perimeter(GEOMETRY)
        self.assertGreaterEqual(abs(area) / 1_000_000, 108_000)
        self.assertLessEqual(abs(area) / 1_000_000, 109_000)
        # GEOS overlays can leave near-collinear sub-picometre strips. Reprojecting
        # their differently segmented edges turns them into artificial area.
        self.assertTrue(GEOMETRY.difference(CANONICAL_DEU.buffer(3e-12)).is_empty)
        self.assertLess(len(json.dumps(ENTITY).encode("utf-8")), 6 * 1024 * 1024)

    def test_reference_points_and_west_berlin_exclusion(self):
        inside = {
            "Rostock": (12.0991, 54.0924),
            "Potsdam": (13.0645, 52.3906),
            "Magdeburg": (11.6276, 52.1205),
            "Leipzig": (12.3731, 51.3397),
            "Dresden": (13.7373, 51.0504),
            "Erfurt": (11.0299, 50.9848),
            "Alexanderplatz": (13.4132, 52.5219),
            "Amt Neuhaus": (10.928, 53.285),
        }
        for name, coordinates in inside.items():
            with self.subTest(name=name):
                self.assertTrue(GEOMETRY.covers(Point(*coordinates)))
        self.assertFalse(GEOMETRY.covers(Point(13.304, 52.503)))

    def test_subtraction_is_an_exact_puzzle_partition(self):
        remainder = CANONICAL_DEU.difference(GEOMETRY)
        self.assertLessEqual(projected_area_km2(GEOMETRY.intersection(remainder)), 0.001)
        reconstructed = unary_union([GEOMETRY, remainder])
        self.assertLessEqual(projected_area_km2(reconstructed.symmetric_difference(CANONICAL_DEU)), 0.001)

    def test_changes_are_confined_to_admitted_sections_and_preserve_holes(self):
        admitted = unary_union([box(*section["bounds"]) for operation in RECIPE["operations"]
                                if operation["operation"] == "boundary-supplement" for section in operation["sections"]])
        delta = GEOMETRY.symmetric_difference(PREVIOUS)
        self.assertGreater(projected_area_km2(delta), 0)
        self.assertLess(projected_area_km2(delta.difference(admitted)), 1e-6)
        old_holes = unary_union([shape({"type": "Polygon", "coordinates": [list(ring.coords)]})
                                 for polygon in PREVIOUS.geoms for ring in polygon.interiors])
        new_holes = unary_union([shape({"type": "Polygon", "coordinates": [list(ring.coords)]})
                                 for polygon in GEOMETRY.geoms for ring in polygon.interiors])
        self.assertLess(projected_area_km2(old_holes.symmetric_difference(new_holes)), 1e-6)
        for name, bounds in {"coast": (9, 53.86, 15.5, 55.5), "Elbe-Neuhaus": (10.25, 52.7, 12, 53.44),
                             "West Berlin": (12.9, 52.3, 13.8, 52.8)}.items():
            with self.subTest(name=name):
                # The old overview boxes also include newly admitted inland
                # Wakenitz and Altmark arcs. Their actual outside-region and
                # unresolved-water preservation is checked against the new baseline.
                self.assertLess(projected_area_km2(delta.intersection(box(*bounds).difference(unary_union([REMAINING_REGION, MAP_REGION])))), 1e-6)

    def test_adopted_lsib_arcs_are_shared_and_not_shifted_by_the_vg25_step(self):
        # Endpoints may be interpolated crossing points; the adopted reference
        # line, rather than membership in its vertex set, owns the shared arc.
        for section in LSIB_OPERATION["sections"]:
            region = box(*section["bounds"])
            shared = GEOMETRY.boundary.intersection(CANONICAL_DEU.boundary.buffer(3e-12)).intersection(region)
            old_shared = PREVIOUS.boundary.intersection(CANONICAL_DEU.boundary.buffer(3e-12)).intersection(region)
            self.assertGreater(shared.length, old_shared.length + 0.1)

    def test_hornburg_supplement_changes_real_geometry_and_preserves_other_sectors(self):
        # Freeze the already accepted LSIB/VG25 result. This catches source-only
        # recipe edits and accidental changes outside the newly admitted area.
        baseline_path = ROOT / "tools/historical-library/sources/east-germany/ddr-before-remaining-vg25.geojson"
        baseline = shape(json.loads(baseline_path.read_text(encoding="utf-8"))["features"][0]["geometry"])
        region = box(10.55, 51.98, 10.91, 52.09)
        stage2 = unary_union([box(*section["bounds"]) for section in VG25_OPERATION["sections"]
                              if section["id"] in {"vg25-eichsfeld-glasehausen", "vg25-schaalsee-mustin-thurow-land"}])
        admitted = unary_union([region, stage2, NORTHERN_REGION, REMAINING_REGION, MAP_REGION])
        delta = baseline.symmetric_difference(GEOMETRY)
        self.assertGreater(projected_area_km2(delta.intersection(region)), 0.01)
        self.assertTrue(delta.difference(admitted.buffer(3e-12)).difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertLess(baseline.boundary.difference(admitted).hausdorff_distance(
            GEOMETRY.boundary.difference(admitted)), 3e-11)
        self.assertEqual(len(GEOMETRY.geoms), len(baseline.geoms))
        for name, bounds in {"Wendebach-Werra": (9.7, 50.8, 10.3, 51.45),
                             "Ohre-Droemling": (10.7, 52.3, 11.3, 52.9),
                             "northern-shores": (10.5, 53.4, 11.2, 54.1)}.items():
            with self.subTest(held=name):
                self.assertTrue(delta.intersection(box(*bounds).difference(unary_union([stage2, NORTHERN_REGION, REMAINING_REGION, MAP_REGION]).buffer(3e-12)))
                                .difference(baseline.boundary.buffer(3e-12)).is_empty)

    def test_stage2_land_sections_change_geometry_and_preserve_all_other_boundaries(self):
        source = RECIPE["sources"]["beforeStage2Supplement"]
        baseline = shape(json.loads((ROOT / source["path"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
        ids = {"vg25-eichsfeld-glasehausen", "vg25-schaalsee-mustin-thurow-land"}
        sections = [section for section in VG25_OPERATION["sections"] if section["id"] in ids]
        self.assertEqual({section["id"] for section in sections}, ids)
        admitted = unary_union([NORTHERN_REGION, REMAINING_REGION, MAP_REGION, *[box(*section["bounds"]) for section in sections]])
        delta = baseline.symmetric_difference(GEOMETRY)
        for section in sections:
            with self.subTest(section=section["id"]):
                self.assertGreater(projected_area_km2(delta.intersection(box(*section["bounds"]))), 0.001)
        self.assertTrue(delta.difference(admitted.buffer(3e-12)).difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertLess(baseline.boundary.difference(admitted).hausdorff_distance(
            GEOMETRY.boundary.difference(admitted)), 3e-11)
        self.assertEqual(len(GEOMETRY.geoms), len(baseline.geoms))
        self.assertEqual([len(p.interiors) for p in GEOMETRY.geoms], [len(p.interiors) for p in baseline.geoms])

    def test_northern_supplement_preserves_lake_ownership_and_unreviewed_boundaries(self):
        source = RECIPE["sources"]["beforeNorthernMapSupplement"]
        baseline = shape(json.loads((ROOT / source["path"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
        self.assertEqual({section["id"] for section in NORTHERN_SECTIONS}, NORTHERN_SECTION_IDS)
        delta = baseline.symmetric_difference(GEOMETRY)
        for section in NORTHERN_SECTIONS:
            with self.subTest(section=section["id"]):
                self.assertGreater(projected_area_km2(delta.intersection(box(*section["bounds"]))), 0.001)
        admitted = unary_union([NORTHERN_REGION, REMAINING_REGION, MAP_REGION])
        self.assertTrue(delta.difference(admitted.buffer(3e-12))
                        .difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertLess(baseline.boundary.difference(admitted).hausdorff_distance(
            GEOMETRY.boundary.difference(admitted)), 3e-11)
        self.assertEqual(len(GEOMETRY.geoms), len(baseline.geoms))
        self.assertEqual([len(p.interiors) for p in GEOMETRY.geoms], [len(p.interiors) for p in baseline.geoms])
        # A real ownership regression: the old diagonal excluded water along
        # Mechower See's west side although the lake belonged to the DDR.
        western_lake_water = Point(10.813891870361987, 53.722674120019214)
        self.assertFalse(baseline.covers(western_lake_water))
        self.assertTrue(GEOMETRY.covers(western_lake_water))
        self.assertFalse(GEOMETRY.covers(Point(10.801354237954948, 53.72486100857692)))
        self.assertTrue(GEOMETRY.covers(Point(10.834842915748618, 53.72035733471293)))

    def test_remaining_fixed_sections_change_geometry_and_preserve_unresolved_water_boundaries(self):
        source = RECIPE["sources"]["beforeAllRemainingSupplement"]
        baseline = shape(json.loads((ROOT / source["path"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
        self.assertEqual({section["id"] for section in REMAINING_SECTIONS}, REMAINING_SECTION_IDS)
        delta = baseline.symmetric_difference(GEOMETRY)
        for section in REMAINING_SECTIONS:
            with self.subTest(section=section["id"]):
                self.assertGreater(projected_area_km2(delta.intersection(box(*section["bounds"]))), 0.001)
        self.assertTrue(delta.difference(unary_union([REMAINING_REGION, MAP_REGION]).buffer(3e-12))
                        .difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertLess(baseline.boundary.difference(unary_union([REMAINING_REGION, MAP_REGION])).hausdorff_distance(
            GEOMETRY.boundary.difference(unary_union([REMAINING_REGION, MAP_REGION]))), 3e-11)
        self.assertEqual(len(GEOMETRY.geoms), len(baseline.geoms))
        self.assertEqual([len(p.interiors) for p in GEOMETRY.geoms], [len(p.interiors) for p in baseline.geoms])
        held = {
            "Elbe-Neuhaus": (10.4, 53.10, 11.8, 53.44),
            "Aland-Elbe": (11.27, 53.0051, 11.8, 53.12),
            "Dumme": (10.65, 52.8151, 11.5, 52.9399),
            "Ohre-Droemling": (10.6, 52.336, 11.3, 52.7099),
            "Warme-Bode": (10.55, 51.70, 10.76, 51.77),
            "Wendebach": (9.9, 51.40, 10.2, 51.47),
            "Werra": (9.7, 50.741, 10.4, 51.39),
            "Trave-coast": (10.6, 53.885, 11.05, 54.2),
        }
        for name, bounds in held.items():
            with self.subTest(held=name):
                region = box(*bounds).difference(MAP_REGION.buffer(3e-12))
                self.assertTrue(delta.intersection(region).difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertTrue(GEOMETRY.covers(Point(10.813891870361987, 53.722674120019214)))
        self.assertFalse(GEOMETRY.covers(Point(10.801354237954948, 53.72486100857692)))

    def test_approved_map_phase_changes_only_safe_covered_arcs(self):
        baseline = shape(json.loads((ROOT / RECIPE["sources"]["beforeApprovedMapPhase"]["path"]).read_text(encoding="utf-8"))["features"][0]["geometry"])
        self.assertEqual({section["id"] for section in MAP_SECTIONS}, MAP_SECTION_IDS)
        delta = baseline.symmetric_difference(GEOMETRY)
        for section in MAP_SECTIONS:
            with self.subTest(section=section["id"]):
                self.assertGreater(projected_area_km2(delta.intersection(box(*section["bounds"]))), 0.001)
        self.assertTrue(delta.difference(MAP_REGION.buffer(3e-12)).difference(baseline.boundary.buffer(3e-12)).is_empty)
        self.assertLess(baseline.boundary.difference(MAP_REGION).hausdorff_distance(GEOMETRY.boundary.difference(MAP_REGION)), 3e-11)
        international = baseline.boundary.intersection(CANONICAL_DEU.boundary.buffer(3e-12))
        self.assertLess(international.difference(GEOMETRY.boundary.buffer(3e-11)).length, 3e-11)
        self.assertEqual(len(GEOMETRY.geoms), len(baseline.geoms))
        self.assertEqual([len(p.interiors) for p in GEOMETRY.geoms], [len(p.interiors) for p in baseline.geoms])
        for section in MAP_SECTIONS:
            if not section["id"].startswith("tk25as-"):
                continue
            operation = next(operation for operation in RECIPE["operations"] if any(item["id"] == section["id"] for item in operation.get("sections", [])))
            reference = json.loads((ROOT / RECIPE["sources"][operation["referenceSource"]]["path"]).read_text(encoding="utf-8"))
            properties = reference["features"][0]["properties"]
            self.assertIn("disputed", properties["boundaryInterpretation"])
            self.assertIn("unresolved", properties["license"])
            self.assertEqual(properties["independentGeoreferencingResidual"], "unmeasured")

    def test_neuhaus_printed_border_has_no_digitization_backtrack(self):
        # The approved period raster shows a continuous downstream curve here.
        # A nonclosed tracing hairpin used to reverse about100m within this box.
        section = GEOMETRY.boundary.intersection(box(10.8048, 53.2810, 10.8080, 53.2840))
        metric = transform(Transformer.from_crs(4326, 25832, always_xy=True).transform, section)
        lines = [metric] if metric.geom_type == "LineString" else list(metric.geoms)
        self.assertTrue(lines)
        for line in lines:
            positions = [x - y for x, y in line.coords]
            steps = [b - a for a, b in zip(positions, positions[1:])]
            self.assertTrue(all(step >= -1 for step in steps) or all(step <= 1 for step in steps))

    def test_admitted_inland_sections_reuse_the_pinned_vg25_derivative(self):
        # This checks which source line was applied, not historical positional
        # accuracy: the documentary admission has no independent period vector.
        source = json.loads((ROOT / RECIPE["sources"]["vg25EasternLands"]["path"]).read_text(encoding="utf-8"))
        to_wgs84 = Transformer.from_crs(25832, 4326, always_xy=True).transform
        reference = transform(to_wgs84, unary_union([shape(feature["geometry"]) for feature in source["features"]]))
        reference = reference.simplify(RECIPE["boundarySupplement"]["presentationToleranceDegrees"], preserve_topology=True).boundary
        for section in VG25_OPERATION["sections"]:
            region = box(*section["bounds"])
            with self.subTest(section=section["id"]):
                shared = GEOMETRY.boundary.intersection(reference.buffer(3e-11)).intersection(region).length
                previous_shared = PREVIOUS.boundary.intersection(reference.buffer(3e-11)).intersection(region).length
                self.assertGreater(shared, previous_shared + 0.0001)


if __name__ == "__main__":
    unittest.main()
