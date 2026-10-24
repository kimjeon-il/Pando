"""Prepare bounded app-test inputs without relabelling or replacing map masters."""
import argparse
import hashlib
import json
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument

from PIL import Image


def prepare(path, maximum_pixels=8_000_000):
    path = pathlib.Path(path).resolve()
    metadata = path.with_suffix(".source.json")
    source = json.loads(metadata.read_text(encoding="utf-8"))
    if source.get("rightsReviewed") is not True or source.get("sha256") != hashlib.sha256(path.read_bytes()).hexdigest():
        raise ValueError("Verified acquired source and provenance required")
    # Reading headers does not allocate the full scan. JPEG draft uses reduced
    # DCT decoding before the final thumbnail; these are app inputs, not labels.
    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = 300_000_000
    try:
        with Image.open(path) as image:
            width, height = image.size
            if image.format != "JPEG" or image.getexif().get(274, 1) != 1:
                raise ValueError("Current acquired JPEG orientation required")
            result = {"sourceId": source["id"], "familyId": source["familyId"], "sourceSha256": source["sha256"],
                      "originalSize": [width, height], "reviewedLabels": False, "purpose": "app-runtime-input-only"}
            if width * height <= maximum_pixels:
                return {**result, "path": path.name, "size": [width, height], "originalPixelsPerInputPixel": [1, 1], "sha256": source["sha256"]}
            if maximum_pixels < 1:
                raise ValueError("Positive pixel budget required")
            target = path.with_name(path.stem + "-analysis.jpg")
            evidence = target.with_suffix(".json")
            if target.exists() or evidence.exists():
                existing = json.loads(evidence.read_text(encoding="utf-8"))
                if existing.get("sourceSha256") != source["sha256"] or existing.get("sha256") != hashlib.sha256(target.read_bytes()).hexdigest():
                    raise ValueError("Existing app input differs; preserve it for inspection")
                if existing["size"][0] * existing["size"][1] > maximum_pixels:
                    raise ValueError("Existing app input exceeds requested pixel budget")
                return existing
            ratio = math.sqrt(maximum_pixels / (width * height))
            bounds = (max(1, math.floor(width * ratio)), max(1, math.floor(height * ratio)))
            image.draft("RGB", bounds)
            image.thumbnail(bounds, Image.Resampling.LANCZOS, reducing_gap=2)
            temporary = target.with_suffix(".jpg.part")
            created, metadata_created, published = False, False, False
            try:
                with temporary.open("xb") as output:
                    created = True
                    image.convert("RGB").save(output, format="JPEG", quality=95)
                result.update(path=target.name, size=list(image.size),
                              originalPixelsPerInputPixel=[width / image.width, height / image.height],
                              sha256=hashlib.sha256(temporary.read_bytes()).hexdigest())
                with evidence.open("x", encoding="utf-8") as output:
                    metadata_created = True
                    json.dump(result, output, ensure_ascii=False, indent=2)
                    output.write("\n")
                temporary.rename(target)
                published = True
                return result
            finally:
                if created and temporary.exists():
                    temporary.unlink()
                if metadata_created and not published:
                    evidence.unlink()
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--sources", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.sources = pathlib.Path(report_argument(args.sources, access='write'))
    if args.sources.resolve().is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
        parser.error("App input derivatives belong to external material storage")
    results = [prepare(path) for path in sorted(args.sources.glob("*.jpg")) if not path.stem.endswith("-analysis")]
    manifest = args.sources / "analysis-inputs.json"
    manifest.write_text(json.dumps({"schemaVersion": 1, "inputs": results, "trainingReady": False}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False))
