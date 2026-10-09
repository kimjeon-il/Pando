#!/usr/bin/env python3
"""Restore legacy hydro research snapshots from pinned Git history to an external directory.

This never writes under the working repository or publishes any obsolete URL.
Use --destination /external/archive, then pass /external/archive/hydro to
report-hydro-v0124.py --hydro-root or /external/archive/hydro/v0.12.4 to
repack-water-v0125.py --source.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PINNED_COMMIT = "6dce59ea427e0728ef29bea31e2e51afbf27d9c8"
PINNED_GROUPS = {
    "v0.12.3": {"files": 13, "bytes": 41_628_073},
    "v0.12.4": {"files": 14, "bytes": 45_341_133},
}
ENTRY = re.compile(rb"^(100644|100755) blob ([0-9a-f]{40})\s+(\d+)\t(assets/data/hydro/v0\.12\.[34]/[A-Za-z0-9._/-]+)$")


def git(repo: Path, *args: str) -> bytes:
    proc = subprocess.run(["git", "-C", str(repo), *args], capture_output=True)
    if proc.returncode:
        raise RuntimeError(f"git {args[0]} failed: {proc.stderr.decode(errors='replace')[:500]}")
    return proc.stdout


def list_historical_files(repo: Path, commit: str, versions: list[str]):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("Expected a full 40-character commit SHA")
    rows = []
    for version in versions:
        if version not in PINNED_GROUPS:
            raise ValueError("Only archived v0.12.3 and v0.12.4 are restorable")
        raw = git(repo, "ls-tree", "-r", "-l", "-z", commit, "--", f"assets/data/hydro/{version}")
        entries = []
        for item in raw.split(b"\0"):
            if not item:
                continue
            match = ENTRY.match(item)
            if not match:
                raise ValueError(f"Unexpected Git tree entry: {item[:140]!r}")
            mode, blob, length, path = match.groups()
            entry = {
                "path": path.decode("ascii"),
                "gitBlob": blob.decode("ascii"),
                "bytes": int(length),
            }
            if not entry["path"].startswith(f"assets/data/hydro/{version}/"):
                raise ValueError("Git tree escaped pinned version directory")
            entries.append(entry)
        if not entries or not any(x["path"].endswith("/manifest.json") for x in entries):
            raise ValueError(f"Missing archived hydro manifest: {version}")
        if commit == PINNED_COMMIT:
            expected = PINNED_GROUPS[version]
            if len(entries) != expected["files"] or sum(x["bytes"] for x in entries) != expected["bytes"]:
                raise ValueError(f"Archived {version} count/byte budget does not match approved evidence")
        rows.extend(entries)
    return sorted(rows, key=lambda x: x["path"])


def verify_file(path: Path, expected: dict) -> bool:
    if not path.is_file() or path.is_symlink():
        return False
    if path.stat().st_size != expected["bytes"]:
        return False
    h = hashlib.sha1(f"blob {expected['bytes']}\0".encode("ascii"))
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest() == expected["gitBlob"]


def restore_archive(repo: Path, destination: Path, *, commit: str, versions: list[str]):
    repo, destination = repo.resolve(), destination.resolve()
    if destination == repo or repo in destination.parents:
        raise ValueError("Restore destination must be outside the checked-out repository")
    entries = list_historical_files(repo, commit, versions)
    restored, reused = 0, 0
    for entry in entries:
        relpath = Path(entry["path"]).relative_to("assets/data")
        out = destination / relpath
        if not out.resolve().is_relative_to(destination):
            raise ValueError("Restore path escapes destination")
        if out.exists() or out.is_symlink():
            if not verify_file(out, entry):
                raise FileExistsError(f"Existing restore target differs from pinned Git Blob: {out}")
            reused += 1
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        if not out.parent.resolve().is_relative_to(destination):
            raise ValueError("Restore output path contains a symlink escape")
        name = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".hydro-restore-", dir=out.parent, delete=False) as dest:
                name = Path(dest.name)
                h = hashlib.sha1(f"blob {entry['bytes']}\0".encode("ascii"))
                copied = 0
                proc = subprocess.Popen(
                    ["git", "-C", str(repo), "cat-file", "blob", entry["gitBlob"]],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                )
                assert proc.stdout is not None
                for chunk in iter(lambda: proc.stdout.read(1024 * 1024), b""):
                    dest.write(chunk)
                    h.update(chunk)
                    copied += len(chunk)
                err = proc.stderr.read() if proc.stderr else b""
                if proc.wait():
                    raise RuntimeError(f"git cat-file failed: {err.decode(errors='replace')[:350]}")
                if copied != entry["bytes"] or h.hexdigest() != entry["gitBlob"]:
                    raise ValueError(f"Restored file does not match pinned Git Blob: {entry['path']}")
            os.replace(name, out)
            restored += 1
        finally:
            if name and name.exists():
                name.unlink()
    summary = {
        "schema": "pandolab-restored-archival-hydro",
        "sourceCommit": commit,
        "restored": restored,
        "alreadyMatching": reused,
        "fileCount": len(entries),
        "totalBytes": sum(x["bytes"] for x in entries),
        "files": entries,
    }
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "hydro-restore-provenance.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, default=ROOT)
    parser.add_argument("--destination", type=Path, required=True,
                        help="Archive root outside the project working tree")
    parser.add_argument("--versions", nargs="+", choices=list(PINNED_GROUPS),
                        default=list(PINNED_GROUPS))
    args = parser.parse_args()
    report = restore_archive(args.repository, args.destination,
                             commit=PINNED_COMMIT, versions=args.versions)
    print(json.dumps({k: report[k] for k in
        ("sourceCommit", "fileCount", "totalBytes", "restored", "alreadyMatching")},
        indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Legacy hydro restoration failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
