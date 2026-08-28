from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

from shapely.geometry import shape
from shapely.validation import explain_validity


ROOT = Path(__file__).resolve().parents[1]
CANONICAL_PATH = ROOT / "assets" / "data" / "countries-ne-5.1.1.geojson"
PREVIEW_PATH = ROOT / "assets" / "data" / "countries-preview-v0.30.0.geojson.gz"
EXPECTED_COUNTRIES = 258
MIN_RING_AREA = 1e-14


def polygons(geometry: dict) -> list:
    if geometry.get("type") == "Polygon":
        return [geometry.get("coordinates", [])]
    if geometry.get("type") == "MultiPolygon":
        return geometry.get("coordinates", [])
    return []


def ring_area(ring: list) -> float:
    return sum(
        ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1]
        for index in range(len(ring) - 1)
    ) / 2


def validate_collection(label: str, collection: dict) -> None:
    errors: list[str] = []
    geometry_entries: list[tuple] = []
    features = collection.get("features", [])
    ids = [str((feature.get("properties") or {}).get("editor_id") or "") for feature in features]
    if collection.get("type") != "FeatureCollection":
        errors.append("FeatureCollection 형식이 아닙니다.")
    if len(features) != EXPECTED_COUNTRIES:
        errors.append(f"국가 수가 {EXPECTED_COUNTRIES}개가 아닙니다: {len(features)}")
    if len(set(ids)) != len(ids) or any(not feature_id for feature_id in ids):
        errors.append("국가 ID가 비어 있거나 중복되었습니다.")

    for feature, feature_id in zip(features, ids):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            errors.append(f"{feature_id}: Polygon 또는 MultiPolygon이 아닙니다.")
            continue
        geometry_shape = shape(geometry)
        geometry_entries.append((geometry_shape, feature_id))
        if geometry_shape.is_empty:
            errors.append(f"{feature_id}: 빈 geometry입니다.")
        if not geometry_shape.is_valid:
            errors.append(f"{feature_id}: {explain_validity(geometry_shape)}")
        for polygon_index, polygon in enumerate(polygons(geometry)):
            if not polygon:
                errors.append(f"{feature_id}:{polygon_index}: 빈 Polygon입니다.")
                continue
            for ring_index, ring in enumerate(polygon):
                prefix = f"{feature_id}:{polygon_index}:{ring_index}"
                if len(ring) < 4:
                    errors.append(f"{prefix}: 꼭짓점이 4개 미만입니다.")
                    continue
                if ring[0] != ring[-1]:
                    errors.append(f"{prefix}: 링이 닫혀 있지 않습니다.")
                if len({tuple(point) for point in ring[:-1]}) < 3:
                    errors.append(f"{prefix}: 서로 다른 꼭짓점이 3개 미만입니다.")
                area = ring_area(ring)
                if abs(area) <= MIN_RING_AREA:
                    errors.append(f"{prefix}: 면적이 없거나 지나치게 작습니다.")
                if (area < 0) != (ring_index == 0):
                    errors.append(f"{prefix}: canonical winding과 다릅니다.")
                for vertex_index in range(1, len(ring)):
                    if ring[vertex_index - 1] == ring[vertex_index]:
                        errors.append(f"{prefix}:{vertex_index}: 연속 중복 꼭짓점입니다.")

    geometry_entries.sort(key=lambda entry: entry[0].bounds[0])
    for left_index, (left_geometry, left_id) in enumerate(geometry_entries):
        left_bounds = left_geometry.bounds
        for right_geometry, right_id in geometry_entries[left_index + 1 :]:
            right_bounds = right_geometry.bounds
            if right_bounds[0] > left_bounds[2]:
                break
            if right_bounds[1] > left_bounds[3] or right_bounds[3] < left_bounds[1]:
                continue
            overlap_area = left_geometry.intersection(right_geometry).area
            if overlap_area > MIN_RING_AREA:
                errors.append(f"{left_id}/{right_id}: 국가 사이에 면적 중첩이 있습니다 ({overlap_area:.12g}).")

    if errors:
        details = "\n".join(f"- {error}" for error in errors[:200])
        suffix = f"\n- 그 밖의 오류 {len(errors) - 200}개" if len(errors) > 200 else ""
        raise SystemExit(f"{label} 국가 도형 검증에 실패했습니다 ({len(errors)}개).\n{details}{suffix}")
    print(f"{label}: {len(features)} countries valid")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--canonical-only", action="store_true")
    args = parser.parse_args()

    canonical = json.loads(CANONICAL_PATH.read_text(encoding="utf-8"))
    validate_collection("canonical", canonical)
    if args.canonical_only:
        return
    preview = json.loads(gzip.decompress(PREVIEW_PATH.read_bytes()))
    validate_collection("preview", preview)
    canonical_ids = [feature["properties"]["editor_id"] for feature in canonical["features"]]
    preview_ids = [feature["properties"]["editor_id"] for feature in preview["features"]]
    if preview_ids != canonical_ids:
        raise SystemExit("preview 국가 ID 또는 순서가 canonical 원본과 다릅니다.")


if __name__ == "__main__":
    main()
