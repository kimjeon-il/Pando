#!/usr/bin/env python3
"""Build lossless, deterministic two-file Hydro v0.13.2 from immutable v0.13.1 roles.

The new hydro.bin contains byte-identical compressed index/core/detail and the
three packed geometry shards. The JSON manifest records individual offsets,
lengths and SHA-256 digests, preserving subresource verification and Range IO.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROLES = ("index", "metadata-core", "metadata-detail", "shard-0", "shard-1", "shard-2")
def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def _source_path(folder: Path, url: str) -> Path:
    if not isinstance(url, str) or not url or url.startswith("/") or "://" in url or "\\" in url:
        raise ValueError("Untrusted hydro asset URL")
    path = (folder / url).resolve(strict=True)
    if not path.is_relative_to(folder.parent.resolve()):
        raise ValueError("Source hydro asset escaped hydro root")
    return path

def create(source_dir: Path, dest_dir: Path, *, check_only: bool = False):
    source_dir = source_dir.resolve()
    dest_dir = dest_dir.resolve()
    if source_dir == dest_dir:
        raise ValueError("Destination must differ from source")
    old = json.loads((source_dir / "manifest.json").read_text("utf-8"))
    if old.get("version") != "0.13.1" or old.get("schema") != "pandolab-water-shards-v5":
        raise ValueError("Source manifest is not the pinned hydro v0.13.1")
    items = [("index", old["index"]), ("metadata-core", old["metadata"]["core"]),
             ("metadata-detail", old["metadata"]["detail"])]
    if [x["id"] for x in old["shards"]] != [0, 1, 2]:
        raise ValueError("Expected three stable hydro geometry shards")
    items += [(f"shard-{x['id']}", x) for x in old["shards"]]
    if tuple(name for name, _ in items) != ROLES:
        raise ValueError("Unexpected hydro resource layout")
    result = copy.deepcopy(old)
    result["version"] = "0.13.2"
    result["format"]["container"] = 1
    targets = [result["index"], result["metadata"]["core"], result["metadata"]["detail"], *result["shards"]]
    payloads = []
    offset = 0
    for (_, input_spec), target in zip(items, targets):
        data = _source_path(source_dir, input_spec["url"]).read_bytes()
        if len(data) != input_spec["bytes"] or digest(data) != input_spec["sha256"]:
            raise ValueError(f"Source byte count/SHA-256 mismatch: {input_spec['url']}")
        if len(data) <= 0:
            raise ValueError("Empty hydro resource")
        target["url"] = "hydro.bin"
        target["offset"] = offset
        target["bytes"] = len(data)
        target["sha256"] = digest(data)
        offset += len(data)
        payloads.append(data)
    combined = b"".join(payloads)
    if len(combined) != offset:
        raise ValueError("Bundle offset arithmetic mismatch")
    result["container"] = {
        "url": "hydro.bin", "bytes": len(combined), "sha256": digest(combined),
        "format": "byte-concatenated-subresources-v1",
        "roles": list(ROLES),
    }
    result["cache"]["name"] = f"pandolab-water-v0.13.2-{digest(combined)[:12]}"
    result["stats"]["compressedBytes"] = len(combined)
    serialized = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if check_only:
        if (dest_dir / "manifest.json").read_bytes() != serialized or (dest_dir / "hydro.bin").read_bytes() != combined:
            raise ValueError("Generated two-file bundle differs from committed bytes")
    else:
        dest_dir.mkdir(parents=True, exist_ok=True)
        (dest_dir / "hydro.bin").write_bytes(combined)
        (dest_dir / "manifest.json").write_bytes(serialized)
    # Decode every segment from the *actual* container, not just the separate originals.
    verify = (dest_dir / "hydro.bin").read_bytes()
    if digest(verify) != result["container"]["sha256"]:
        raise ValueError("Whole-container SHA mismatch")
    for part, (_, old_spec) in zip(targets, items):
        start, length = part["offset"], part["bytes"]
        if start < 0 or start + length > len(verify) or digest(verify[start:start + length]) != old_spec["sha256"]:
            raise ValueError("Bundle part differs from original compressed data")
    return {"status": "checked" if check_only else "generated",
            "files": 2, "logicalAssets": len(items),
            "containerBytes": len(combined),
            "containerSha256": result["container"]["sha256"],
            "manifestBytes": len(serialized),
            "sourceVersion": old["version"], "targetVersion": result["version"]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "assets/data/hydro/v0.13.1")
    parser.add_argument("--output", type=Path, default=ROOT / "assets/data/hydro/v0.13.2")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    print(json.dumps(create(args.source, args.output, check_only=args.check), indent=2))

if __name__ == "__main__":
    main()
