#!/usr/bin/env python3
"""Prepare (but do not deploy) a source-verified Hydro v0.13.2 metadata-only update.

Read the exact original hydro.bin + manifest from pinned PandoLab-library-data.
Rewrite only names/aliases/trib names/OSM relation IDs for reviewed systems.
Original geometry pack/index/shard compressed bytes stay identical. Output must
be a separate staging directory, never the published assets/data/hydro tree.
"""
from __future__ import annotations
import argparse
import copy
import gzip
import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path
# Transitional producer: source review is owned by the Node validation contract.
def load_independent_hydronyms(path):
    checked = subprocess.run(
        ["node", str(Path(__file__).with_name("hydro-independent-name-policy.mjs")),
         "--input", str(path)], capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(checked.stdout)



def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def metadata_section(data: bytes, spec: dict) -> list:
    part = data[spec["offset"]:spec["offset"] + spec["bytes"]]
    if len(part) != spec["bytes"] or digest(part) != spec["sha256"]:
        raise ValueError("Original Hydro metadata integrity mismatch")
    obj = json.loads(gzip.decompress(part))
    if obj.get("version") != 5 or not isinstance(obj.get("features"), list):
        raise ValueError("Unexpected Hydro metadata format")
    return obj["features"]


def encoded_metadata(rows: list) -> bytes:
    text = json.dumps({"version": 5, "features": rows}, ensure_ascii=False, separators=(",", ":"))
    return gzip.compress(text.encode("utf-8"), compresslevel=9, mtime=0)


def rewrite(manifest: dict, bundle: bytes, substitutions: dict,
            source_file: Path, *, lake_substitutions: dict | None = None) -> tuple[dict, bytes, dict]:
    if manifest.get("version") != "0.13.2" or manifest.get("schema") != "pandolab-water-shards-v5":
        raise ValueError("This metadata-only revision is pinned to the Hydro v0.13.2 format")
    if len(bundle) != manifest["container"]["bytes"] or digest(bundle) != manifest["container"]["sha256"]:
        raise ValueError("Hydro whole-bundle identity mismatch")
    ordered_specs = [manifest["index"], manifest["metadata"]["core"],
                     manifest["metadata"]["detail"], *manifest["shards"]]
    original_parts = []
    for spec in ordered_specs:
        if spec["url"] != manifest["container"]["url"]:
            raise ValueError("Hydro resource unexpectedly outside original bundle")
        p = bundle[spec["offset"]:spec["offset"] + spec["bytes"]]
        if len(p) != spec["bytes"] or digest(p) != spec["sha256"]:
            raise ValueError("Hydro source segment mismatch")
        original_parts.append(p)
    core = metadata_section(bundle, manifest["metadata"]["core"])
    detail = metadata_section(bundle, manifest["metadata"]["detail"])
    if len(core) != len(detail) or len(core) != manifest["metadata"]["featureCount"]:
        raise ValueError("Metadata feature count mismatch")
    detail_by_fid = {int(x["fid"]): x for x in detail}
    if len(detail_by_fid) != len(detail):
        raise ValueError("Repeated detail feature IDs")
    next_core, next_detail = copy.deepcopy(core), copy.deepcopy(detail)
    next_detail_by_fid = {int(x["fid"]): x for x in next_detail}
    system_changes = Counter()
    system_old = {}
    alias_removals = {}
    lake_changes = Counter()
    for row in next_core:
        lake_review = (lake_substitutions or {}).get(row.get("awId"))
        if lake_review:
            if row["category"] != "lake" or row["name"] != lake_review["previousNameKo"]:
                raise ValueError("Original lake identity/name mismatch")
            row["name"] = lake_review["nameKo"]
            lake_changes[row["awId"]] += 1
        ident = str(row.get("systemId") or "")
        review = substitutions.get(ident)
        if not review:
            continue
        if row["category"] != "river" or not row.get("awId") == f"hydro-system:{ident}":
            raise ValueError("Invalid published Hydro system ID for replacement")
        if row["name"] != review["previousNameKo"]:
            raise ValueError(f"Original name mismatch for {ident}: {row['name']}")
        previous = system_old.setdefault(ident, row["name"])
        if previous != row["name"]:
            raise ValueError(f"Fragment name divergence for {ident}")
        row["name"] = review["nameKo"]
        row["mainstemNameKo"] = review["nameKo"]
        detail_row = next_detail_by_fid[int(row["fid"])]
        original_detail_row = detail_by_fid[int(row["fid"])]
        count = sum(len(original_detail_row.get(key, []))
                    for key in ("aliases", "tributaryNames", "osmRelationIds"))
        alias_removals[ident] = alias_removals.get(ident, 0) + count
        for key in ("aliases", "tributaryNames", "osmRelationIds"):
            detail_row.pop(key, None)
        # Each visible river fragment carries the same independent source URLs,
        # so a clicked fragment can display provenance without a second lookup.
        references = list(dict.fromkeys(src["url"] for src in review["independentSources"]))
        if not references or any("openstreetmap" in url.lower() or
                                 "overpass" in url.lower() for url in references):
            raise ValueError(f"Non-independent source URL for {ident}")
        detail_row["independentSourceUrls"] = references
        if int(row["fragmentIndex"]) == 0:
            if review["aliases"]:
                detail_row["aliases"] = list(review["aliases"])
            if review["tributaryNames"]:
                detail_row["tributaryNames"] = list(review["tributaryNames"])
        if "OSM waterway names" in str(detail_row.get("source") or ""):
            detail_row["source"] = "HydroRIVERS 1.0 · independently verified river names"
        system_changes[ident] += 1
    if set(system_changes) != set(substitutions):
        raise ValueError("Missing reviewed source system from existing bundle")
    if set(lake_changes) != set(lake_substitutions or {}):
        raise ValueError("Missing reviewed lake from existing bundle")
    if set(next_detail_by_fid) != set(detail_by_fid):
        raise ValueError("Detail FID identity changed")
    by_fid = {int(row["fid"]): str(row.get("systemId") or "") for row in next_core}
    for detail_row in next_detail:
        sid = by_fid[int(detail_row["fid"])]
        if sid not in substitutions:
            continue
        expected = list(dict.fromkeys(src["url"] for src in substitutions[sid]["independentSources"]))
        if detail_row.get("independentSourceUrls") != expected or detail_row.get("osmRelationIds"):
            raise ValueError(f"Unverified provenance survived system {sid}")
    if len(next_core) != len(core):
        raise ValueError("Core count changed")

    new_parts = list(original_parts)
    new_parts[1] = encoded_metadata(next_core)
    new_parts[2] = encoded_metadata(next_detail)
    new_manifest = copy.deepcopy(manifest)
    descriptors = [new_manifest["index"], new_manifest["metadata"]["core"],
                   new_manifest["metadata"]["detail"], *new_manifest["shards"]]
    offset = 0
    for spec, part in zip(descriptors, new_parts):
        spec["offset"] = offset
        spec["bytes"] = len(part)
        spec["sha256"] = digest(part)
        offset += len(part)
    updated_bundle = b"".join(new_parts)
    new_manifest["container"]["bytes"] = offset
    new_manifest["container"]["sha256"] = digest(updated_bundle)
    new_manifest["stats"]["compressedBytes"] = offset
    new_manifest["cache"]["name"] = "pandolab-water-v0.13.2-independent-" + digest(new_parts[1])[:16]
    if substitutions:
        new_manifest["sources"]["independentHydronymReplacements"] = {
            "file": source_file.name, "sha256": digest(source_file.read_bytes()),
            "replacedSystems": len(substitutions), "geometryChanged": False
        }
    if lake_substitutions:
        new_manifest["sources"]["lakeNameCorrections"] = {
            "file": source_file.name, "sha256": digest(source_file.read_bytes()),
            "names": lake_substitutions, "geometryChanged": False
        }
    total = len(substitutions)
    new_manifest["stats"]["osmWaterwayMatchCount"] -= total
    new_manifest["sources"]["osmWaterways"]["matchedSystems"] -= total
    new_manifest["sources"]["nameEnrichment"]["osmMatches"] -= total
    decrease = Counter(r["hydroRiversRegion"] for r in substitutions.values())
    for region in new_manifest["sources"]["hydroRivers"]:
        region["osmMatches"] -= decrease.get(region["datasetCode"], 0)
        if region["osmMatches"] < 0:
            raise ValueError("OSM provenance regional count underflow")
    if min(new_manifest["stats"]["osmWaterwayMatchCount"],
           new_manifest["sources"]["osmWaterways"]["matchedSystems"],
           new_manifest["sources"]["nameEnrichment"]["osmMatches"]) < 0:
        raise ValueError("OSM aggregate count underflow")
    if sum(x["osmMatches"] for x in new_manifest["sources"]["hydroRivers"]) != new_manifest["stats"]["osmWaterwayMatchCount"]:
        raise ValueError("Regional OSM count mismatch")

    for i in [0, *range(3, len(new_parts))]:
        if new_parts[i] != original_parts[i]:
            raise AssertionError("Hydro geometry/index bytes changed")
    next_core_by_fid = {int(row["fid"]): row for row in next_core}
    for row in next_detail:
        if str(next_core_by_fid[int(row["fid"])].get("systemId")) in substitutions and row.get("osmRelationIds"):
            raise ValueError("OSM relation ID survived replacement")
    return new_manifest, updated_bundle, {
        "changedSystemIds": sorted(system_changes, key=int),
        "changedCoreFragments": sum(system_changes.values()),
        "changedLakeFragments": dict(lake_changes),
        "originalNameBySystem": system_old,
        "removedOriginalAliasesTributariesRelations": alias_removals,
        "originalIndexSha256": digest(original_parts[0]),
        "newIndexSha256": digest(new_parts[0]),
        "originalGeometryShardsSha256": [digest(p) for p in original_parts[3:]],
        "newGeometryShardsSha256": [digest(p) for p in new_parts[3:]],
        "beforeBundleSha256": digest(bundle),
        "afterBundleSha256": digest(updated_bundle),
        "remainingOsmMatchedSystems": new_manifest["stats"]["osmWaterwayMatchCount"],
        "sourceIndependentSystemCount": total,
        "renamedSystemCount": sum(v["nameKo"] != v["previousNameKo"] for v in substitutions.values()),
        "nameUnchangedSourceReplacementCount": sum(v["nameKo"] == v["previousNameKo"] for v in substitutions.values()),
        "runtimeDeployed": False
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", type=Path, required=True)
    p.add_argument("--bundle", type=Path, required=True)
    p.add_argument("--replacements", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    args = p.parse_args()
    output = args.output_dir.resolve()
    bundle_path = args.bundle.resolve()
    if output == bundle_path.parent or (bundle_path.parent in output.parents):
        raise ValueError("Staging must not touch original pinned Hydro assets")
    reviewed = load_independent_hydronyms(args.replacements)
    original = json.loads(args.manifest.read_text(encoding="utf-8"))
    new_manifest, new_bundle, proof = rewrite(
        original, args.bundle.read_bytes(), reviewed, args.replacements
    )
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(
        json.dumps(new_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (output / "hydro.bin").write_bytes(new_bundle)
    # Keep provenance input alongside published manifest so each cited
    # URL remains individually auditable after pinning the runtime bundle.
    (output / args.replacements.name).write_bytes(args.replacements.read_bytes())
    (output / "proof.json").write_text(
        json.dumps(proof, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("HYDRO_NONOSM_PROOF=" + json.dumps(proof, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
