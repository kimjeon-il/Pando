"""Train/evaluate/export real reviewed maps. Run from the application checkout."""
import argparse
import hashlib
import json
import pathlib
import random
import numpy as np
import torch
from PIL import Image, ImageDraw, ImageOps
from corpus import CHANNELS, validate_corpus, evaluation_groups, corpus_path, corpus_fingerprint
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
            annotation = json.loads(corpus_path(self.root, sheet['annotations']).read_text(encoding='utf-8'))
            validity = None
            if annotation.get('origin') in {'publisher-layer-export', 'semap-human-mask-export'}:
                with Image.open(corpus_path(self.root, annotation['validRaster']['path'])) as source:
                    validity = np.asarray(source).copy()
            for y in range(0, height, SIZE - OVERLAP):
                for x in range(0, width, SIZE - OVERLAP):
                    if validity is not None and not np.any(validity[y:y + SIZE, x:x + SIZE]):
                        continue
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
        if annotation.get('origin') in {'publisher-layer-export', 'semap-human-mask-export'}:
            arrays = []
            for field in ['raster', 'validRaster']:
                with Image.open(corpus_path(self.root, annotation[field]['path'])) as raster:
                    bits = np.asarray(raster.crop((x, y, x + SIZE, y + SIZE)), dtype=np.uint8)
                arrays.append(torch.from_numpy(np.stack([((bits & (1 << channel)) != 0).astype(np.float32)
                                                        for channel in range(len(CHANNELS))])))
            target, validity = arrays
        else:
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
            validity = torch.from_numpy(np.asarray(valid, dtype=np.float32).copy()[None] / 255).expand(len(CHANNELS), -1, -1)
        tile = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
        tile.paste(image.crop((x, y, min(x + SIZE, width), min(y + SIZE, height))), (0, 0))
        overview = image.resize((256, 256), Image.Resampling.BILINEAR)
        return tensor(tile), tensor(overview), torch.tensor([x / width, y / height, min(SIZE, width - x) / width, min(SIZE, height - y) / height]), target, validity, sheet_index


def batch_loss(model, batch, device, positive_weight=None):
    tile, overview, position, target, valid, _ = batch
    logits = model(tile.to(device), overview.to(device), position.to(device))
    return boundary_loss(logits, target.to(device), valid.to(device), positive_weight)


def optimizer_update(scaler, optimizer):
    """A reduced AMP scale means overflow skipped the parameter update."""
    before = scaler.get_scale()
    scaler.step(optimizer)
    scaler.update()
    return scaler.get_scale() >= before


def raster_supervision(root, sheets):
    counts = np.zeros((len(CHANNELS), 2), dtype=np.int64)
    for sheet in sheets:
        annotation = json.loads(corpus_path(root, sheet['annotations']).read_text(encoding='utf-8'))
        if annotation.get('origin') not in {'publisher-layer-export', 'semap-human-mask-export'}:
            raise ValueError('Training-only mode requires verified raster labels')
        with Image.open(corpus_path(root, annotation['raster']['path'])) as image:
            target = np.asarray(image, dtype=np.uint8)
        with Image.open(corpus_path(root, annotation['validRaster']['path'])) as image:
            valid = np.asarray(image, dtype=np.uint8)
        for channel in range(len(CHANNELS)):
            observed = (valid & (1 << channel)) != 0
            counts[channel] += [np.count_nonzero(observed), np.count_nonzero(observed & ((target & (1 << channel)) != 0))]
    return counts


def train(args, corpus, root):
    if args.initialize_checkpoint and not args.training_only:
        raise ValueError('Checkpoint initialization requires training-only mode until lineage independence is verified')
    sheets = corpus["sheets"]
    sets = {split: [sheet for sheet in sheets if sheet["split"] == split] for split in ["train", "validation", "test"]}
    if not sets['train'] or (not args.training_only and any(not rows for rows in sets.values())):
        raise ValueError("Training requires separate real train, validation and test map families")
    output = pathlib.Path(args.output)
    if output.exists() or output.with_suffix('.pending.pt').exists():
        raise ValueError('Training output already exists; preserve the existing model')
    datasets = [MapTiles(root, sets['train'])]
    supervision = raster_supervision(root, sets['train']) if args.training_only else None
    if args.auxiliary_corpus:
        auxiliary_path = pathlib.Path(args.auxiliary_corpus).resolve()
        auxiliary = validate_corpus(json.loads(auxiliary_path.read_text(encoding='utf-8')), auxiliary_path.parent, training_only=True)
        if set(row['id'] for row in sheets) & set(row['id'] for row in auxiliary['sheets']):
            raise ValueError('Duplicate sheet identity across training corpora')
        datasets.append(MapTiles(auxiliary_path.parent, auxiliary['sheets']))
        supervision += raster_supervision(auxiliary_path.parent, auxiliary['sheets'])
        sets['train'] = [*sets['train'], *auxiliary['sheets']]
    fingerprint = corpus_fingerprint(args.corpus, args.auxiliary_corpus)
    if any(not len(dataset) for dataset in datasets):
        raise ValueError('Each corpus must contain actual supervised training tiles')
    used_ids = [[dataset.sheets[i]['id'] for i in sorted({tile[0] for tile in dataset.tiles})] for dataset in datasets]
    positive_weight = None if supervision is None else np.clip((supervision[:, 0] - supervision[:, 1]) / np.maximum(supervision[:, 1], 1), 1, 64).tolist()
    initialization = None
    if args.initialize_checkpoint:
        model, initial = load_model(args.initialize_checkpoint, args.device)
        initialization = dict(sha256=hashlib.sha256(pathlib.Path(args.initialize_checkpoint).read_bytes()).hexdigest(),
                              attemptedBatches=initial['steps'], optimizerUpdates=initial.get('optimizerUpdates'),
                              corpusSha256=initial['corpusSha256'])
    else:
        model = ReferenceBoundaryModel(pretrained=True).to(args.device)
    unobserved = [] if supervision is None else [i for i, count in enumerate(supervision[:, 0]) if count == 0]
    with torch.no_grad():
        for channel in unobserved:
            model.head.weight[channel].zero_()
            model.head.bias[channel].fill_(-20)
    loader = torch.utils.data.DataLoader(torch.utils.data.ConcatDataset(datasets), batch_size=args.batch, shuffle=True, num_workers=0)
    validation = None if args.training_only else torch.utils.data.DataLoader(MapTiles(root, sets["validation"]), batch_size=1, num_workers=0)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-4)
    amp = str(args.device).startswith('cuda')
    scaler = torch.amp.GradScaler('cuda', enabled=amp)
    best, steps, updates, skipped = float("inf"), 0, 0, 0
    for epoch in range(args.epochs):
        for parameter in model.encoder.parameters():
            parameter.requires_grad_(epoch >= 2)
        model.train()
        if epoch < 2:
            model.encoder.eval()
        losses = []
        for batch in loader:
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device_type='cuda' if amp else 'cpu', enabled=amp):
                loss = batch_loss(model, batch, args.device, positive_weight)
            if not torch.isfinite(loss):
                raise RuntimeError("Non-finite training loss")
            scaler.scale(loss).backward()
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
            applied = optimizer_update(scaler, optimizer)
            updates += int(applied)
            skipped += int(not applied)
            steps += 1
            losses.append(float(loss.detach()))
        model.eval()
        training_loss = sum(losses) / len(losses)
        with torch.no_grad():
            validation_loss = None if validation is None else sum(float(batch_loss(model, batch, args.device)) for batch in validation) / len(validation)
        score = training_loss if args.training_only else validation_loss
        print(json.dumps(dict(epoch=epoch, attemptedBatches=steps, optimizerUpdates=updates, skippedUpdates=skipped,
                              trainingLoss=training_loss, validationLoss=validation_loss)), flush=True)
        if score < best:
            best = score
            torch.save(dict(schemaVersion=1, model=model.state_dict(), classes=CHANNELS, trained=True,
                            steps=steps, stepCountKind='attempted-batches', optimizerUpdates=updates, skippedUpdates=skipped,
                            initialization=initialization,
                            trainingUsedSheetIds=used_ids, tilesPerCorpus=[len(dataset) for dataset in datasets],
                            epoch=epoch, seed=20261022, corpusSha256=fingerprint,
                            sheetIds={key: [row["id"] for row in value] for key, value in sets.items()},
                            trainingOnly=args.training_only, selectionMetric='trainingLoss' if args.training_only else 'validationLoss',
                            trainingLoss=training_loss, validationLoss=validation_loss, evaluationStatus="pending",
                            supervisedPixels=None if supervision is None else supervision.tolist(), positiveWeight=positive_weight,
                            unobservedChannels=[CHANNELS[i] for i in unobserved],
                            toolchain=dict(torch=str(torch.__version__), device=str(args.device), amp=amp,
                                           encoderWeights='MobileNet_V3_Large_Weights.IMAGENET1K_V2')),
                       output.with_suffix('.pending.pt'))
            output.with_suffix('.pending.pt').replace(output)


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
    if checkpoint.get('trainingOnly'):
        raise ValueError('Publisher training-only checkpoint cannot claim independent evaluation')
    digest = corpus_fingerprint(args.corpus)
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
    manifest.update(trainingOnly=checkpoint['trainingOnly'], trainingBatches=checkpoint['steps'],
                    optimizerUpdates=checkpoint['optimizerUpdates'], stepCountKind=checkpoint['stepCountKind'],
                    unobservedChannels=checkpoint['unobservedChannels'])
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
    parser.add_argument("--training-only", action='store_true', help='Train publisher-derived labels without claiming independent evaluation')
    parser.add_argument('--auxiliary-corpus', help='Additional verified training-only raster corpus')
    parser.add_argument('--initialize-checkpoint', help='Continue training from an actual trained checkpoint')
    args = parser.parse_args()
    if args.training_only and args.command != 'train':
        parser.error('--training-only is only valid for train')
    if args.auxiliary_corpus and not (args.command == 'train' and args.training_only):
        parser.error('--auxiliary-corpus requires training-only train')
    if args.initialize_checkpoint and not (args.command == 'train' and args.training_only):
        parser.error('--initialize-checkpoint requires training-only train')
    if args.epochs < 1 or args.batch < 1:
        parser.error('Positive epochs and batch required')
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
        corpus = validate_corpus(json.loads(path.read_text(encoding="utf-8")), path.parent, training_only=args.training_only)
        (train if args.command == "train" else evaluate)(args, corpus, path.parent)
