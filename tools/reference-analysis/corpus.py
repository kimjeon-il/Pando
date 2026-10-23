"""Application-owned reference-map corpus contracts. Data stays in the library."""
import argparse
import hashlib
import json
import pathlib
import re

CHANNELS = ["international", "administrative", "coast", "hydro", "transport", "text", "frame"]
LANGUAGES = set(json.loads((pathlib.Path(__file__).resolve().parents[2] / 'assets/vendor/reference-analysis/manifest.json').read_text(encoding='utf-8'))['languages']) - {'osd'}


def validate_corpus(value, root=None):
    if value.get("schemaVersion") != 1 or not isinstance(value.get("sheets"), list):
        raise ValueError("Corpus schemaVersion=1 and sheets are required")
    seen, splits = set(), {}
    for sheet in value["sheets"]:
        if not sheet.get("id") or sheet["id"] in seen:
            raise ValueError("Unique sheet id required")
        seen.add(sheet["id"])
        if sheet.get("split") not in {"train", "validation", "test"}:
            raise ValueError("Explicit train/validation/test split required")
        for key in ["familyId", "editionId", "duplicateGroup"]:
            group = sheet.get(key)
            if not group:
                raise ValueError(key + " required")
            previous = splits.setdefault((key, group), sheet["split"])
            if previous != sheet["split"]:
                raise ValueError(key + " crosses split boundaries")
        if not sheet.get("annotations"):
            raise ValueError("Reviewed annotations required; unlabelled sources are inventory only")
        if not re.fullmatch("[a-f0-9]{64}", sheet.get("sha256", "")):
            raise ValueError("Original image sha256 required")
        if sheet.get("language") not in LANGUAGES or not sheet.get("script"):
            raise ValueError("Supported language and explicit script required")
        if sheet.get("mapKind") not in {"color", "monochrome"}:
            raise ValueError("mapKind must be color or monochrome")
        if not all(sheet.get("source", {}).get(key) for key in ["url", "license"]):
            raise ValueError("Source URL and license required")
        for key in ["image", "annotations"]:
            path = pathlib.PurePosixPath(sheet[key])
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Corpus paths must stay inside corpus root")
            if root:
                absolute = (pathlib.Path(root) / path).resolve()
                if not absolute.is_relative_to(pathlib.Path(root).resolve()):
                    raise ValueError("Corpus symlink escapes root")
                if key == "image" and hashlib.sha256(absolute.read_bytes()).hexdigest() != sheet["sha256"]:
                    raise ValueError("Original image hash changed: " + sheet["id"])
                if key == "annotations":
                    annotations = json.loads(absolute.read_text(encoding="utf-8"))
                    if annotations.get("reviewed") is not True or annotations.get("schemaVersion") != 1:
                        raise ValueError("Human-reviewed current annotation schema required")
    return value


def evaluation_groups(sheets):
    groups = {}
    for sheet in sheets:
        key = "/".join(sheet[k] for k in ["mapKind", "script", "language"])
        groups.setdefault(key, []).append(sheet["id"])
    return groups


def inventory(reports, sources):
    entries = []
    for root in [pathlib.Path(reports), pathlib.Path(sources)]:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".tif", ".jp2", ".pdf", ".md"}:
                continue
            if path.suffix.lower() == ".md":
                text = path.read_text(encoding="utf-8", errors="replace")
                urls = sorted(set(re.findall(r"https?://[^\s<>\])]+", text)))
                urls = [url for url in urls if re.search(r"wms|kartenforum|fotothek|\.pdf|\.jpg|\.tif|iiif|map|atlas", url, re.I)]
                if urls:
                    entries.append(dict(path=str(path), kind="source-references", urls=urls, annotationStatus="unreviewed"))
            else:
                original = root == pathlib.Path(sources) or 'sources' in path.relative_to(root).parts[:-1]
                kind = "original-candidate" if original else "report-evidence-candidate"
                source_metadata, derivative_metadata = path.with_suffix('.source.json'), path.with_suffix('.json')
                if source_metadata.is_file() and json.loads(source_metadata.read_text(encoding='utf-8')).get('materialKind') == 'official-downsample':
                    kind = 'source-downsample-candidate'
                if derivative_metadata.is_file() and json.loads(derivative_metadata.read_text(encoding='utf-8')).get('purpose') == 'app-runtime-input-only':
                    kind = 'analysis-derivative'
                entries.append(dict(path=str(path), kind=kind,
                                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(), annotationStatus="unlabelled"))
    return dict(schemaVersion=1, entries=entries, trainingReady=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus")
    parser.add_argument("--reports")
    parser.add_argument("--sources")
    parser.add_argument("--output")
    args = parser.parse_args()
    if args.corpus:
        path = pathlib.Path(args.corpus)
        result = validate_corpus(json.loads(path.read_text(encoding="utf-8")), path.parent)
        print(json.dumps(dict(valid=True, groups=evaluation_groups(result["sheets"])), ensure_ascii=False))
    else:
        if not all([args.reports, args.sources, args.output]):
            parser.error("Inventory requires --reports, --sources and --output")
        output = pathlib.Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(inventory(args.reports, args.sources), ensure_ascii=False, indent=2), encoding="utf-8")
