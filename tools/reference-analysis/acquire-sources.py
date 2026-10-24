"""Acquire a bounded, provenance-preserving seed inventory, never training labels.

Run in PandoLab; --output must name storage in the external library.
"""
import argparse
import datetime
import hashlib
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument
import shutil
import urllib.request


def acquire(source, root, opener=urllib.request.urlopen):
    if source.get("rightsReviewed") is not True or not source.get("license"):
        return {"id": source["id"], "status": "rights-unverified"}
    name = source["id"]
    if not name or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in name):
        raise ValueError("Unsafe source id")
    format = source.get('format', 'jpeg')
    if format not in {'jpeg', 'pdf'}:
        raise ValueError('Unsupported source format')
    suffix = '.pdf' if format == 'pdf' else '.jpg'
    root = pathlib.Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    target, evidence = root / (name + suffix), root / (name + ".source.json")
    for path in (target, evidence):
        if path.resolve().parent != root or path.is_symlink():
            raise ValueError("Source target escapes storage root")
    if target.exists() or evidence.exists():
        if not (target.is_file() and evidence.is_file()):
            raise ValueError("Incomplete existing source; preserve it for inspection")
        stored = json.loads(evidence.read_text(encoding="utf-8"))
        if stored.get("url") != source["url"] or stored.get("sha256") != hashlib.sha256(target.read_bytes()).hexdigest():
            raise ValueError("Existing source differs; never overwrite original evidence")
        if source.get("sha256", stored["sha256"]) != stored["sha256"]:
            raise ValueError("Existing source differs from pinned original hash")
        return {"id": name, "status": "verified-existing", "bytes": target.stat().st_size}
    maximum = source["maximumBytes"]
    if shutil.disk_usage(root).free < maximum + 128 * 1024 * 1024:
        raise ValueError("Insufficient storage for bounded source acquisition")
    temporary = root / (name + suffix + ".part")
    # Exclusive creation protects an active acquisition or an unfamiliar remnant.
    created, metadata_created, published = False, False, False
    try:
        with temporary.open("xb") as output:
            created = True
            request = urllib.request.Request(source["url"], headers={"User-Agent": "PandoLab-reference-corpus/1.0"})
            with opener(request, timeout=60) as response:
                count, sha, md5 = 0, hashlib.sha256(), hashlib.md5()
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > maximum:
                        raise ValueError("Source exceeds declared download budget")
                    output.write(chunk)
                    sha.update(chunk)
                    md5.update(chunk)
        if (source.get("expectedBytes", count) != count or source.get("md5", md5.hexdigest()) != md5.hexdigest()
                or source.get("sha256", sha.hexdigest()) != sha.hexdigest()):
            raise ValueError("Source does not match depositor size/checksum")
        with temporary.open("rb") as image:
            signature = b'%PDF-' if format == 'pdf' else b'\xff\xd8'
            if not count or image.read(len(signature)) != signature:
                raise ValueError('Source is not a ' + ('PDF' if format == 'pdf' else 'JPEG'))
        record = {**source, "sha256": sha.hexdigest(), "bytes": count,
                  "acquiredAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "annotations": None, "reviewedLabels": False, "trainingReady": False}
        # Two exclusive writes, then publish the downloaded original. Neither
        # an existing source nor an unrelated .part file is overwritten.
        with evidence.open("x", encoding="utf-8") as output:
            metadata_created = True
            json.dump(record, output, ensure_ascii=False, indent=2)
            output.write("\n")
        temporary.rename(target)
        published = True
        return {"id": name, "status": "acquired-unlabelled", "bytes": count, "sha256": sha.hexdigest()}
    finally:
        if created and temporary.exists():
            temporary.unlink()
        if metadata_created and not published:
            evidence.unlink()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=pathlib.Path, default=pathlib.Path(__file__).with_name("source-catalog.json"))
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.catalog = pathlib.Path(report_argument(args.catalog, access='read'))
    args.output = pathlib.Path(report_argument(args.output, access='write'))
    workspace = pathlib.Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(workspace):
        parser.error("Original materials must be stored outside the application worktree")
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    if catalog.get("schemaVersion") != 1:
        parser.error("Current source catalog required")
    for entry in catalog["sources"]:
        print(json.dumps(acquire(entry, args.output), ensure_ascii=False), flush=True)
