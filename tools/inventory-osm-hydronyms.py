#!/usr/bin/env python3
"""Read the exact published Hydro v0.13.2 metadata and inventory OSM-matched systems.

Read-only. No OSM API requests, no geometry modification, no guesswork about
which name was sourced from which supplier. Designed for stepwise attribution
and independent replacement research.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def read_section(bundle: bytes, descriptor: dict) -> list[dict]:
    start, size = descriptor["offset"], descriptor["bytes"]
    section = bundle[start:start + size]
    if len(section) != size or hashlib.sha256(section).hexdigest() != descriptor["sha256"]:
        raise ValueError("Hydro metadata section integrity mismatch")
    payload = json.loads(gzip.decompress(section))
    if payload.get("version") != 5 or not isinstance(payload.get("features"), list):
        raise ValueError("Unexpected Hydro v5 metadata")
    return payload["features"]


def inventory(manifest: dict, bundle: bytes) -> dict:
    if manifest.get("version") != "0.13.2":
        raise ValueError("This audit requires the current Hydro v0.13.2 reference")
    core = {int(row["fid"]): row for row in read_section(bundle, manifest["metadata"]["core"])}
    details = read_section(bundle, manifest["metadata"]["detail"])
    systems = defaultdict(lambda: {
        "nameKo": "", "source": [], "osmRelations": set(), "aliases": set(),
        "tributaryNames": set(), "featureCount": 0, "bounds": None,
        "roles": set(), "sourceIds": set(),
    })
    for detail in details:
        fid = int(detail["fid"])
        row = core[fid]
        if row.get("category") != "river":
            continue
        system_id = str(row.get("systemId") or "")
        if not system_id:
            raise ValueError(f"River fid {fid} missing systemId")
        agg = systems[system_id]
        agg["nameKo"] = row["name"]
        agg["featureCount"] += 1
        agg["source"].append(str(detail.get("source") or ""))
        agg["osmRelations"].update(int(id) for id in detail.get("osmRelationIds", []) if int(id) > 0)
        agg["aliases"].update(str(name) for name in detail.get("aliases", []) if name)
        agg["tributaryNames"].update(str(name) for name in detail.get("tributaryNames", []) if name)
        agg["roles"].add(str(row.get("role") or ""))
        # Hydro reach IDs are retained as provenance, but may span several continents.
        agg["sourceIds"].update(str(n) for n in str(detail.get("sourceId") or "").split(",") if n)
        if not agg["bounds"]:
            agg["bounds"] = list(row.get("bounds") or [])
        elif row.get("bounds"):
            b, c = agg["bounds"], row["bounds"]
            agg["bounds"] = [min(b[0], c[0]), min(b[1], c[1]), max(b[2], c[2]), max(b[3], c[3])]
    matched = []
    for id, aggregate in sorted(systems.items(), key=lambda x: int(x[0])):
        if not aggregate["osmRelations"]:
            continue
        bbox = aggregate["bounds"]
        result = {"systemId": id, "nameKo": aggregate["nameKo"],
                  "osmRelationIds": sorted(aggregate["osmRelations"]),
                  "aliases": sorted(aggregate["aliases"]), "tributaryNames": sorted(aggregate["tributaryNames"]),
                  "sourceLabels": sorted(set(aggregate["source"])), "roles": sorted(aggregate["roles"]),
                  "featureCount": aggregate["featureCount"],
                  "bounds": [round(float(v) / 1_000_000, 4) for v in bbox] if bbox else [],
                  "hydroReachCount": len(aggregate["sourceIds"])}
        matched.append(result)
    expected = manifest["sources"]["osmWaterways"]["matchedSystems"]
    if len(matched) != expected or len(matched) != manifest["stats"]["osmWaterwayMatchCount"]:
        raise ValueError(f"OSM system count mismatch: {len(matched)} != {expected}")
    return {
        "schema": "pando-osm-hydro-inventory-v1",
        "sourceManifestVersion": manifest["version"],
        "sourceManifestDataset": manifest["dataset"],
        "sourceOSMExportHash": manifest["sources"]["osmWaterways"]["sha256"],
        "disclaimer": "A relation match does NOT establish that displayed Korean name is OSM-derived; classify independently.",
        "matchedSystems": len(matched),
        "items": matched,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    obj = inventory(json.loads(args.manifest.read_text(encoding="utf-8")), args.bundle.read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("OSM_AUDIT_TOTAL=" + str(obj["matchedSystems"]), flush=True)
    for row in obj["items"]:
        print("OSM_AUDIT_ROW=" + json.dumps(row, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
