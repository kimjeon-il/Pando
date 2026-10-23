"""Train/evaluate/export real reviewed maps. Run from the application checkout."""
import argparse
import hashlib
import json
import pathlib
import random
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps
from corpus import CHANNELS, validate_corpus, evaluation_groups
from model import ReferenceBoundaryModel, boundary_loss
from evaluation import boundary_counts, metrics

SIZE, OVERLAP = 512, 64


def tensor(image):
    value = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1) / 255
    return (value - torch.tensor([.485, .456, .406])[:, None, None]) / torch.tensor([.229, .224, .225])[:, None, None]


class MapTiles(torch.utils.data.Dataset):
    def __init__(self, root, sheets):
        self.root, self.sheets, self.tiles = pathlib.Path(root), sheets, []
        for index, sheet in enumerate(sheets):
            with Image.open(self.root / sheet["image"]) as source:
                width, height = ImageOps.exif_transpose(source).size
            for y in range(0, height, SIZE - OVERLAP):
                for x in range(0, width, SIZE - OVERLAP):
                    self.tiles.append((index, x, y))

    def __len__(self):
        return len(self.tiles)

    def __getitem__(self, index):
        sheet_index, x, y = self.tiles[index]
        sheet = self.sheets[sheet_index]
        with Image.open(self.root / sheet["image"]) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        width, height = image.size
        annotation = json.loads((self.root / sheet["annotations"]).read_text(encoding="utf-8"))
        if annotation.get("width") != width or annotation.get("height") != height:
            raise ValueError("Annotations must use oriented original image dimensions")
        masks = [Image.new("L", (SIZE, SIZE)) for _ in CHANNELS]
        for row in annotation.get("lines", []):
            if row["kind"] not in CHANNELS:
                raise ValueError("Unknown semantic annotation class")
            coordinates = [(px - x, py - y) for px, py in row["points"]]
            ImageDraw.Draw(masks[CHANNELS.index(row["kind"])]).line(coordinates, fill=255, width=max(1, round(row["width"])))
        valid = Image.new("L", (SIZE, SIZE))
        ImageDraw.Draw(valid).rectangle((0, 0, min(SIZE, width - x) - 1, min(SIZE, height - y) - 1), fill=255)
        for polygon in annotation.get("ignore", []):
            ImageDraw.Draw(valid).polygon([(px - x, py - y) for px, py in polygon], fill=0)
        target = torch.from_numpy(np.stack([np.asarray(mask, dtype=np.float32) / 255 for mask in masks]))
        validity = torch.from_numpy(np.asarray(valid, dtype=np.float32).copy()[None] / 255)
        tile = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
        tile.paste(image.crop((x, y, min(x + SIZE, width), min(y + SIZE, height))), (0, 0))
        overview = image.resize((256, 256), Image.Resampling.BILINEAR)
        return tensor(tile), tensor(overview), torch.tensor([x / width, y / height, min(SIZE, width - x) / width, min(SIZE, height - y) / height]), target, validity, sheet_index


def batch_loss(model, batch, device):
    tile, overview, position, target, valid, _ = batch
    logits = model(tile.to(device), overview.to(device), position.to(device))
    return boundary_loss(logits, target.to(device), valid.to(device))


def train(args, corpus, root):
    sheets = corpus["sheets"]
    sets = {split: [sheet for sheet in sheets if sheet["split"] == split] for split in ["train", "validation", "test"]}
    if any(not rows for rows in sets.values()):
        raise ValueError("Training requires separate real train, validation and test map families")
    model = ReferenceBoundaryModel(pretrained=True).to(args.device)
    loader = torch.utils.data.DataLoader(MapTiles(root, sets["train"]), batch_size=args.batch, shuffle=True, num_workers=0)
    validation = torch.utils.data.DataLoader(MapTiles(root, sets["validation"]), batch_size=1, num_workers=0)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-4)
    best, steps = float("inf"), 0
    for epoch in range(args.epochs):
        for parameter in model.encoder.parameters():
            parameter.requires_grad_(epoch >= 2)
        model.train()
        if epoch < 2:
            model.encoder.eval()
        losses = []
        for batch in loader:
            optimizer.zero_grad(set_to_none=True)
            loss = batch_loss(model, batch, args.device)
            if not torch.isfinite(loss):
                raise RuntimeError("Non-finite training loss")
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            optimizer.step()
            steps += 1
            losses.append(float(loss.detach()))
        model.eval()
        with torch.no_grad():
            score = sum(float(batch_loss(model, batch, args.device)) for batch in validation) / len(validation)
        print(json.dumps(dict(epoch=epoch, steps=steps, trainingLoss=sum(losses) / len(losses), validationLoss=score)), flush=True)
        if score < best:
            best = score
            torch.save(dict(schemaVersion=1, model=model.state_dict(), classes=CHANNELS, trained=True,
                            steps=steps, corpusSha256=hashlib.sha256(pathlib.Path(args.corpus).read_bytes()).hexdigest(),
                            sheetIds={key: [row["id"] for row in value] for key, value in sets.items()},
                            validationLoss=score, evaluationStatus="pending"), args.output)


def load_model(path, device):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("schemaVersion") != 1 or checkpoint.get("classes") != CHANNELS or checkpoint.get("trained") is not True or checkpoint.get("steps", 0) < 1:
        raise ValueError("A genuinely trained current reference-boundary checkpoint is required")
    model = ReferenceBoundaryModel().to(device)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    return model, checkpoint


def evaluate(args, corpus, root):
    model, checkpoint = load_model(args.checkpoint, args.device)
    digest = hashlib.sha256(pathlib.Path(args.corpus).read_bytes()).hexdigest()
    if checkpoint["corpusSha256"] != digest:
        raise ValueError("Evaluation corpus differs from training split contract")
    sheets = [row for row in corpus["sheets"] if row["split"] == "test"]
    groups = evaluation_groups(sheets)
    counts = {key: np.zeros((3, 4), dtype=np.int64) for key in groups}
    per_sheet = {}
    with torch.no_grad():
        for sheet in sheets:
            annotation = json.loads((root / sheet['annotations']).read_text(encoding='utf-8'))
            width, height = annotation['width'], annotation['height']
            probability = np.zeros((3, height, width), dtype=np.float32)
            weights = np.zeros((height, width), dtype=np.float32)
            dataset = MapTiles(root, [sheet])
            for index in range(len(dataset)):
                tile, overview, position, _, _, _ = dataset[index]
                _, x, y = dataset.tiles[index]
                h, w = min(SIZE, height - y), min(SIZE, width - x)
                yy, xx = np.mgrid[:h, :w]
                weight = np.minimum.reduce([np.ones((h, w)), (xx + 1) / OVERLAP, (w - xx) / OVERLAP,
                                            (yy + 1) / OVERLAP, (h - yy) / OVERLAP]).astype(np.float32)
                output = torch.sigmoid(model(tile[None].to(args.device), overview[None].to(args.device), position[None].to(args.device))).cpu().numpy()[0, :3, :h, :w]
                probability[:, y:y+h, x:x+w] += output * weight
                weights[y:y+h, x:x+w] += weight
            if not np.all(weights > 0):
                raise ValueError('Evaluation left uncovered source pixels')
            value = boundary_counts(probability / weights >= .55, annotation)
            key = '/'.join(sheet[k] for k in ['mapKind', 'script', 'language'])
            counts[key] += value
            per_sheet[sheet['id']] = metrics(value)
    group_metrics = {key: metrics(value) for key, value in counts.items()}
    report = dict(schemaVersion=1, metric='full-sheet-source-pixel-euclidean-tolerance', tolerance='max(2px, half annotated original stroke width)',
                  corpusSha256=digest, groups=group_metrics, sheets=per_sheet, releaseApproved=False,
                  pending=['independent georeference region evaluation', 'all script/map-family coverage', 'Windows WebView2 and Android offline performance'])
    pathlib.Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')



def export(args):
    model, checkpoint = load_model(args.checkpoint, "cpu")
    with torch.no_grad():
        torch.onnx.export(model, (torch.zeros(1, 3, SIZE, SIZE), torch.zeros(1, 3, 256, 256), torch.zeros(1, 4)),
                          args.output, input_names=["tile", "overview", "position"], output_names=["logits"], opset_version=17, dynamo=False)
    path = pathlib.Path(args.output)
    manifest = dict(schemaVersion=1, architecture="mobilenetv3-unet-context-v1", classes=CHANNELS, tileSize=SIZE, overlap=OVERLAP,
                    overviewSize=256, model=dict(url=path.name, sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size),
                    corpusSha256=checkpoint["corpusSha256"], evaluationStatus="pending", releaseApproved=False)
    path.with_suffix(".manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["train", "evaluate", "export"])
    parser.add_argument("--corpus")
    parser.add_argument("--checkpoint")
    parser.add_argument("--output", required=True)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()
    random.seed(20261022)
    np.random.seed(20261022)
    torch.manual_seed(20261022)
    torch.set_num_threads(2)
    pathlib.Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    if args.command == "export":
        export(args)
    else:
        if not args.corpus:
            parser.error("--corpus is required")
        path = pathlib.Path(args.corpus)
        corpus = validate_corpus(json.loads(path.read_text(encoding="utf-8")), path.parent)
        (train if args.command == "train" else evaluate)(args, corpus, path.parent)
