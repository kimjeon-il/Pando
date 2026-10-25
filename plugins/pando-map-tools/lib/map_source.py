"""Bounded map source acquisition shared by Work analysis and corpus preparation."""
import datetime
import hashlib
import json
import pathlib
import shutil
import urllib.request
import urllib.parse

FORMATS = {'jpeg': '.jpg', 'pdf': '.pdf', 'png': '.png', 'webp': '.webp'}


def acquire(source, root, opener=urllib.request.urlopen):
    if source.get("rightsReviewed") is not True or not source.get("license"):
        return {"id": source["id"], "status": "rights-unverified"}
    if urllib.parse.urlparse(source["url"]).scheme != "https":
        raise ValueError("Map source download requires HTTPS")
    name = source["id"]
    if not name or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in name):
        raise ValueError("Unsafe source id")
    format = source.get('format', 'jpeg')
    if format not in FORMATS:
        raise ValueError('Unsupported source format')
    suffix = FORMATS[format]
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
        return {"id": name, "status": "verified-existing", "bytes": target.stat().st_size, "path": str(target), "provenancePath": str(evidence)}
    maximum = source.get("maximumBytes", 64 * 1024 * 1024)
    if not isinstance(maximum, int) or maximum <= 0:
        raise ValueError('A positive bounded source download budget is required')
    if shutil.disk_usage(root).free < maximum + 128 * 1024 * 1024:
        raise ValueError("Insufficient storage for bounded source acquisition")
    temporary = root / (name + suffix + ".part")
    # Exclusive creation protects an active acquisition or an unfamiliar remnant.
    created, metadata_created, published = False, False, False
    try:
        with temporary.open("xb") as output:
            created = True
            request = urllib.request.Request(source["url"], headers={"User-Agent": "Map-Toolkit/0.4"})
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
            header = image.read(16)
            valid = {'pdf': header.startswith(b'%PDF-'), 'jpeg': header.startswith(b'\xff\xd8'),
                     'png': header.startswith(b'\x89PNG\r\n\x1a\n'),
                     'webp': header.startswith(b'RIFF') and header[8:12] == b'WEBP'}
            if not count or not valid[format]:
                raise ValueError('Source is not a ' + format.upper())
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
        return {"id": name, "status": "acquired-unlabelled", "bytes": count, "sha256": sha.hexdigest(), "path": str(target), "provenancePath": str(evidence)}
    finally:
        if created and temporary.exists():
            temporary.unlink()
        if metadata_created and not published:
            evidence.unlink()



if __name__ == '__main__':
    import signal
    import sys
    def cancelled(signum, frame):
        raise InterruptedError('Map source acquisition cancelled')
    signal.signal(signal.SIGTERM, cancelled)
    if len(sys.argv) != 3:
        raise SystemExit('Usage: map_source.py <source.json> <private-input-directory>')
    source = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    print(json.dumps(acquire(source, sys.argv[2]), ensure_ascii=False))
