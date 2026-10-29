"""Train/evaluate/export real reviewed maps. Run from the application checkout."""
import argparse
import hashlib
import io
import json
import pathlib
import sys
import random
import collections
import math
import numpy as np
import torch
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument

from corpus import (CHANNELS, RASTER_ORIGINS, validate_corpus, evaluation_groups, corpus_path,
                    corpus_fingerprint, review_masks, build_training_lineage, assert_evaluation_independence)
from model import ReferenceBoundaryModel, boundary_loss
from evaluation import boundary_counts, metrics, boundary_admission, confounder_counts, confounder_nonregression

SIZE, OVERLAP = 512, 64


def tensor(image):
    value = torch.from_numpy(np.asarray(image, dtype=np.float32).copy()).permute(2, 0, 1) / 255
    return (value - torch.tensor([.485, .456, .406])[:, None, None]) / torch.tensor([.229, .224, .225])[:, None, None]


class MapTiles(torch.utils.data.Dataset):
    def __init__(self, root, sheets, *, augment_conditions=False, supervised_only=True):
        self.root, self.sheets, self.tiles = pathlib.Path(root), sheets, []
        self.augment_conditions, self.epoch = augment_conditions, 0
        for index, sheet in enumerate(sheets):
            with Image.open(self.root / sheet["image"]) as source:
                width, height = ImageOps.exif_transpose(source).size
            annotation = json.loads(corpus_path(self.root, sheet['annotations']).read_text(encoding='utf-8'))
            validity = None
            if annotation.get('origin') in RASTER_ORIGINS:
                with Image.open(corpus_path(self.root, annotation['validRaster']['path'])) as source:
                    validity = np.asarray(source).copy()
            else:
                _, known = review_masks(annotation)
                validity = known.any(axis=0)
            for y in range(0, height, SIZE - OVERLAP):
                for x in range(0, width, SIZE - OVERLAP):
                    if supervised_only and validity is not None and not np.any(validity[y:y + SIZE, x:x + SIZE]):
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
        if annotation.get('origin') in RASTER_ORIGINS:
            arrays = []
            for field in ['raster', 'validRaster']:
                with Image.open(corpus_path(self.root, annotation[field]['path'])) as raster:
                    bits = np.asarray(raster.crop((x, y, x + SIZE, y + SIZE)), dtype=np.uint8)
                arrays.append(torch.from_numpy(np.stack([((bits & (1 << channel)) != 0).astype(np.float32)
                                                        for channel in range(len(CHANNELS))])))
            target, validity = arrays
        else:
            target, validity = [torch.from_numpy(value.astype(np.float32))
                                for value in review_masks(annotation, window=(x, y, SIZE, SIZE))]
        tile = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
        tile.paste(image.crop((x, y, min(x + SIZE, width), min(y + SIZE, height))), (0, 0))
        overview = image.resize((256, 256), Image.Resampling.BILINEAR)
        if self.augment_conditions:
            rng = random.Random(20261024 + self.epoch * 1000003 + index)
            gray = rng.random() < .25
            contrast, brightness, saturation = rng.uniform(.75, 1.25), rng.uniform(.85, 1.1), rng.uniform(.5, 1.3)
            resolution, blur, quality = rng.choice([.5, .75, 1]), rng.choice([0, .25, .5]), rng.choice([55, 75, 95])

            def scan_conditions(value):
                if gray:
                    value = ImageOps.grayscale(value).convert('RGB')
                value = ImageEnhance.Color(value).enhance(saturation)
                value = ImageEnhance.Contrast(value).enhance(contrast)
                value = ImageEnhance.Brightness(value).enhance(brightness)
                if resolution != 1:
                    size = value.size
                    value = value.resize(tuple(round(n * resolution) for n in size), Image.Resampling.BILINEAR)
                    value = value.resize(size, Image.Resampling.BILINEAR)
                if blur:
                    value = value.filter(ImageFilter.GaussianBlur(blur))
                buffer = io.BytesIO()
                value.save(buffer, format='JPEG', quality=quality)
                buffer.seek(0)
                with Image.open(buffer) as encoded:
                    return encoded.convert('RGB')

            tile, overview = scan_conditions(tile), scan_conditions(overview)
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
        if annotation.get('origin') in RASTER_ORIGINS:
            with Image.open(corpus_path(root, annotation['raster']['path'])) as image:
                bits = np.asarray(image, dtype=np.uint8)
            with Image.open(corpus_path(root, annotation['validRaster']['path'])) as image:
                known = np.asarray(image, dtype=np.uint8)
            target, valid = [np.stack([(value & (1 << channel)) != 0 for channel in range(len(CHANNELS))])
                             for value in [bits, known]]
        else:
            target, valid = review_masks(annotation)
        for channel in range(len(CHANNELS)):
            counts[channel] += [np.count_nonzero(valid[channel]), np.count_nonzero(valid[channel] & target[channel])]
    return counts


def balanced_tile_indices(datasets, epoch, seed):
    """Visit every original, balance corpora, then sample originals uniformly."""
    rng = random.Random(seed + epoch)
    total = sum(len(dataset.tiles) for dataset in datasets)
    result, offset, corpora = [], 0, []
    for dataset in datasets:
        groups = collections.defaultdict(list)
        for i, tile in enumerate(dataset.tiles):
            groups[dataset.sheets[tile[0]]['duplicateGroup']].append(offset + i)
        if not groups:
            raise ValueError('Balanced training requires supervised original maps')
        corpora.append(groups)
        offset += len(dataset.tiles)
    quota = max(math.ceil(total / len(corpora)), max(map(len, corpora)))
    for groups in corpora:
        keys = sorted(groups)
        selected = [rng.choice(groups[key]) for key in keys]
        selected.extend(rng.choice(groups[rng.choice(keys)]) for _ in range(quota - len(selected)))
        result.extend(selected)
    rng.shuffle(result)
    return result


def require_macro_scope(sheets, root):
    if not sheets or any(sheet.get('geographicScope') not in {'world', 'continent', 'country'}
                         or not sheet.get('scopeEvidence') for sheet in sheets):
        raise ValueError('Verified whole-map macro scope required for every training source')
    for sheet in sheets:
        annotation = json.loads(corpus_path(root, sheet['annotations']).read_text(encoding='utf-8'))
        if annotation.get('origin') != 'macro-vector-supervision' and not annotation.get('reviewed'):
            raise ValueError('Source-bound macro supervision required; manifest scope alone is insufficient')


def train(args, corpus, root):
    if args.initialize_checkpoint and not args.training_only:
        raise ValueError('Checkpoint initialization requires training-only mode until lineage independence is verified')
    sheets = corpus["sheets"]
    sets = {split: [sheet for sheet in sheets if sheet["split"] == split] for split in ["train", "validation", "test"]}
    if not sets['train'] or (not args.training_only and any(not rows for rows in sets.values())):
        raise ValueError("Training requires separate real train, validation and test map families")
    if args.macro_only:
        require_macro_scope(sets['train'], root)
    output = pathlib.Path(args.output)
    if output.exists() or output.with_suffix('.pending.pt').exists():
        raise ValueError('Training output already exists; preserve the existing model')
    datasets = [MapTiles(root, sets['train'], augment_conditions=args.augment_conditions)]
    supervision = raster_supervision(root, sets['train'])
    if args.auxiliary_corpus:
        auxiliary_path = pathlib.Path(args.auxiliary_corpus).resolve()
        auxiliary = validate_corpus(json.loads(auxiliary_path.read_text(encoding='utf-8')), auxiliary_path.parent, training_only=True)
        if args.macro_only:
            require_macro_scope(auxiliary['sheets'], auxiliary_path.parent)
        if set(row['id'] for row in sheets) & set(row['id'] for row in auxiliary['sheets']):
            raise ValueError('Duplicate sheet identity across training corpora')
        datasets.append(MapTiles(auxiliary_path.parent, auxiliary['sheets'], augment_conditions=args.augment_conditions))
        supervision += raster_supervision(auxiliary_path.parent, auxiliary['sheets'])
        sets['train'] = [*sets['train'], *auxiliary['sheets']]
    validation_path = pathlib.Path(args.validation_corpus).resolve() if args.validation_corpus else None
    if validation_path:
        validation_corpus = validate_corpus(json.loads(validation_path.read_text(encoding='utf-8')), validation_path.parent)
        if not validation_corpus['sheets'] or any(row['split'] != 'validation' for row in validation_corpus['sheets']):
            raise ValueError('Validation corpus must contain only frozen validation sheets, never final-test inputs')
        if sets['validation']:
            raise ValueError('Choose exactly one validation corpus owner')
        sets['validation'] = validation_corpus['sheets']
    fingerprint = corpus_fingerprint(args.corpus, args.auxiliary_corpus)
    if any(not len(dataset) for dataset in datasets):
        raise ValueError('Each corpus must contain actual supervised training tiles')
    used_ids = [[dataset.sheets[i]['id'] for i in sorted({tile[0] for tile in dataset.tiles})] for dataset in datasets]
    positive_weight = None if supervision is None else np.clip((supervision[:, 0] - supervision[:, 1]) / np.maximum(supervision[:, 1], 1), 1, 64).tolist()
    initialization = None
    parent_lineage = None
    if args.initialize_checkpoint:
        model, initial = load_model(args.initialize_checkpoint, args.device)
        initialization = dict(sha256=hashlib.sha256(pathlib.Path(args.initialize_checkpoint).read_bytes()).hexdigest(),
                              attemptedBatches=initial['steps'], optimizerUpdates=initial.get('optimizerUpdates'),
                              corpusSha256=initial['corpusSha256'])
        parent_lineage = initial.get('lineage')
        if parent_lineage is None:
            raise ValueError('Initializer has no complete lineage; use a verified initializer or the pretrained encoder')
    else:
        model = ReferenceBoundaryModel(pretrained=True).to(args.device)
    training_lineage = build_training_lineage(sets['train'], parent=parent_lineage,
        parent_sha256=initialization['sha256'] if initialization else None)
    if sets['validation']:
        assert_evaluation_independence(training_lineage, sets['validation'], split='validation')
    lineage = build_training_lineage([*sets['train'], *sets['validation']], parent=parent_lineage,
        parent_sha256=initialization['sha256'] if initialization else None)
    unobserved = [] if supervision is None else [i for i, (known, positive) in enumerate(supervision) if positive == 0 or positive == known]
    with torch.no_grad():
        for channel in unobserved:
            model.head.weight[channel].zero_()
            model.head.bias[channel].fill_(-20)
    training_dataset = torch.utils.data.ConcatDataset(datasets)
    validation = torch.utils.data.DataLoader(MapTiles(validation_path.parent if validation_path else root, sets['validation']), batch_size=1, num_workers=0) if sets['validation'] else None
    if validation is not None and not len(validation):
        raise ValueError('Validation corpus has no known supervised pixels')
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=1e-4)
    amp = str(args.device).startswith('cuda')
    scaler = torch.amp.GradScaler('cuda', enabled=amp)
    best, steps, updates, skipped = float("inf"), 0, 0, 0
    stale = 0
    for epoch in range(args.epochs):
        for dataset in datasets:
            dataset.epoch = epoch
        sampler = balanced_tile_indices(datasets, epoch, 20261023) if args.balance_sources else None
        loader = torch.utils.data.DataLoader(training_dataset, batch_size=args.batch, sampler=sampler,
                                            shuffle=sampler is None, num_workers=0)
        for parameter in model.encoder.parameters():
            parameter.requires_grad_(epoch >= args.freeze_encoder_epochs)
        model.train()
        if epoch < args.freeze_encoder_epochs:
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
        score = validation_loss if validation is not None else training_loss
        print(json.dumps(dict(epoch=epoch, attemptedBatches=steps, optimizerUpdates=updates, skippedUpdates=skipped,
                              trainingLoss=training_loss, validationLoss=validation_loss)), flush=True)
        if score < best:
            best = score
            stale = 0
            torch.save(dict(schemaVersion=1, model=model.state_dict(), classes=CHANNELS, trained=True,
                            steps=steps, stepCountKind='attempted-batches', optimizerUpdates=updates, skippedUpdates=skipped,
                            initialization=initialization, lineage=lineage,
                            sampling='balanced-corpora-originals-with-coverage' if args.balance_sources else 'uniform-tiles',
                            samplingSeed=20261023 if args.balance_sources else None,
                            geographicFocus='macro-only' if args.macro_only else 'unrestricted',
                            conditionAugmentation=dict(version='paired-photometric-scan-v1', seed=20261024,
                                geometry='unchanged', grayscaleProbability=.25, contrast=[.75,1.25], brightness=[.85,1.1],
                                saturation=[.5,1.3], resolution=[.5,.75,1], blur=[0,.25,.5], jpegQuality=[55,75,95]) if args.augment_conditions else None,
                            learningRate=args.learning_rate, freezeEncoderEpochs=args.freeze_encoder_epochs,
                            trainingUsedSheetIds=used_ids, tilesPerCorpus=[len(dataset) for dataset in datasets],
                            epoch=epoch, seed=20261022, corpusSha256=fingerprint,
                            sheetIds={key: [row["id"] for row in value] for key, value in sets.items()},
                            trainingOnly=args.training_only, selectionMetric='validationLoss' if validation is not None else 'trainingLoss',
                            validationCorpusSha256=corpus_fingerprint(validation_path) if validation_path else None,
                            trainingLoss=training_loss, validationLoss=validation_loss, evaluationStatus="pending",
                            supervisedPixels=None if supervision is None else supervision.tolist(), positiveWeight=positive_weight,
                            unobservedChannels=[CHANNELS[i] for i in unobserved],
                            toolchain=dict(torch=str(torch.__version__), device=str(args.device), amp=amp,
                                           encoderWeights='MobileNet_V3_Large_Weights.IMAGENET1K_V2')),
                       output.with_suffix('.pending.pt'))
            output.with_suffix('.pending.pt').replace(output)
        else:
            stale += 1
        if validation is not None and stale >= args.patience:
            break


def load_model(path, device):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint.get("schemaVersion") != 1 or checkpoint.get("classes") != CHANNELS or checkpoint.get("trained") is not True or checkpoint.get("steps", 0) < 1:
        raise ValueError("A genuinely trained current reference-boundary checkpoint is required")
    model = ReferenceBoundaryModel().to(device)
    model.load_state_dict(checkpoint["model"])
    model.eval()
    return model, checkpoint


def evaluate(args, corpus, root):
    if pathlib.Path(args.output).exists():
        raise ValueError('Evaluation output already exists; preserve the frozen evidence')
    model, checkpoint = load_model(args.checkpoint, args.device)
    digest = corpus_fingerprint(args.corpus)
    sheets = [row for row in corpus["sheets"] if row["split"] == "test"]
    if not sheets:
        raise ValueError('Frozen final-test originals required')
    diagnostic = getattr(args, 'diagnostic_only', False)
    try:
        assert_evaluation_independence(checkpoint.get('lineage'), sheets)
        independence = dict(passed=True)
    except ValueError as error:
        if not diagnostic:
            raise
        independence = dict(passed=False, reason=str(error))
    groups = evaluation_groups(sheets)
    counts = {key: np.zeros((3, 4), dtype=np.int64) for key in groups}
    per_sheet, confounders, coverage = {}, {}, {}
    with torch.no_grad():
        for sheet in sheets:
            annotation = json.loads((root / sheet['annotations']).read_text(encoding='utf-8'))
            width, height = annotation['width'], annotation['height']
            probability = np.zeros((3, height, width), dtype=np.float32)
            weights = np.zeros((height, width), dtype=np.float32)
            dataset = MapTiles(root, [sheet], supervised_only=False)
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
            prediction = probability / weights >= .55
            value = boundary_counts(prediction, annotation)
            confounders[sheet['id']] = confounder_counts(prediction, annotation)
            _, known = review_masks(annotation)
            coverage[sheet['id']] = {kind: dict(knownPixels=int(known[index].sum()), originalPixels=width*height)
                                    for index, kind in enumerate(CHANNELS)}
            key = '/'.join(sheet[k] for k in ['mapKind', 'script', 'language'])
            counts[key] += value
            per_sheet[sheet['id']] = metrics(value)
    group_metrics = {key: metrics(value) for key, value in counts.items()}
    baseline_path = getattr(args, 'baseline_report', None)
    baseline = json.loads(pathlib.Path(baseline_path).read_text(encoding='utf-8')) if baseline_path else None
    if baseline and (baseline.get('corpusSha256') != digest or baseline.get('threshold') != .55 or baseline.get('coverage') != coverage):
        raise ValueError('Baseline must use the exact frozen corpus, threshold and known-pixel scope')
    nonregression = confounder_nonregression(confounders, baseline.get('confounders') if baseline else None)
    admission = boundary_admission(per_sheet, required_channels=[kind for kind in CHANNELS[:3] if kind not in checkpoint['unobservedChannels']])
    admission['passed'] = admission['passed'] and nonregression['passed'] and independence['passed'] and not diagnostic
    if diagnostic:
        admission['failures'].append(dict(reason='diagnostic-baseline-is-not-qualification'))
    if not nonregression['passed']:
        admission['failures'].append(dict(reason='confounder-nonregression-not-passed'))
    report = dict(schemaVersion=1, metric='full-sheet-source-pixel-euclidean-tolerance', tolerance='max(2px, half annotated original stroke width)',
                  corpusSha256=digest, trainingCorpusSha256=checkpoint['corpusSha256'],
                  lineageSha256=hashlib.sha256(json.dumps(checkpoint['lineage'], sort_keys=True).encode()).hexdigest() if checkpoint.get('lineage') else None,
                  checkpointSha256=hashlib.sha256(pathlib.Path(args.checkpoint).read_bytes()).hexdigest(),
                  reviewKinds=sorted({json.loads((root/row['annotations']).read_text(encoding='utf-8'))['review']['kind'] for row in sheets}),
                  trainingOnly=checkpoint['trainingOnly'], evaluationStatus='pending',
                  groups=group_metrics, sheets=per_sheet, threshold=.55, diagnosticOnly=diagnostic, independence=independence,
                  confounders=confounders, coverage=coverage, nonregression=nonregression,
                  baselineReportSha256=hashlib.sha256(pathlib.Path(baseline_path).read_bytes()).hexdigest() if baseline_path else None,
                  admission=admission,releaseApproved=False,
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
                    unobservedChannels=checkpoint['unobservedChannels'], lineage=checkpoint.get('lineage'))
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
    parser.add_argument('--validation-corpus', help='Frozen source-reviewed validation-only corpus; final test is never read during training')
    parser.add_argument('--diagnostic-only', action='store_true', help='Describe an old model without claiming independent qualification')
    parser.add_argument('--baseline-report', help='Same-corpus diagnostic baseline for frozen confounder nonregression')
    parser.add_argument('--patience', type=int, default=5)
    parser.add_argument('--initialize-checkpoint', help='Continue training from an actual trained checkpoint')
    parser.add_argument('--balance-sources', action='store_true', help='Visit every original and balance corpora/source items each epoch')
    parser.add_argument('--macro-only', action='store_true', help='Require verified world/continent/country map scope for every source')
    parser.add_argument('--augment-conditions', action='store_true', help='Deterministic paired photometric/scan conditions; labels and geometry stay unchanged')
    parser.add_argument('--learning-rate', type=float, default=1e-4)
    parser.add_argument('--freeze-encoder-epochs', type=int, default=2)
    args = parser.parse_args()
    if (args.diagnostic_only or args.baseline_report) and args.command != 'evaluate':
        parser.error('Diagnostic and baseline options are only valid for evaluate')
    if args.training_only and args.command != 'train':
        parser.error('--training-only is only valid for train')
    if args.auxiliary_corpus and not (args.command == 'train' and args.training_only):
        parser.error('--auxiliary-corpus requires training-only train')
    if args.initialize_checkpoint and not (args.command == 'train' and args.training_only):
        parser.error('--initialize-checkpoint requires training-only train')
    if args.macro_only and args.command != 'train':
        parser.error('--macro-only is only valid for train')
    if args.augment_conditions and args.command != 'train':
        parser.error('--augment-conditions is only valid for train')
    if args.epochs < 1 or args.batch < 1 or args.patience < 1:
        parser.error('Positive epochs and batch required')
    if not math.isfinite(args.learning_rate) or not 0 < args.learning_rate <= .01 or args.freeze_encoder_epochs < 0:
        parser.error('Finite learning rate in (0,.01] and non-negative encoder freeze epochs required')
    random.seed(20261022)
    np.random.seed(20261022)
    torch.manual_seed(20261022)
    torch.set_num_threads(2)
    for field in vars(args):
        if field in ['corpus', 'auxiliary_corpus', 'validation_corpus', 'checkpoint', 'initialize_checkpoint', 'baseline_report']:
            setattr(args, field, report_argument(getattr(args, field), access='read', siblings=field in ['corpus', 'auxiliary_corpus', 'validation_corpus']))
    args.output = report_argument(args.output, access='write')
    pathlib.Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    if args.command == "export":
        export(args)
    else:
        if not args.corpus:
            parser.error("--corpus is required")
        path = pathlib.Path(args.corpus)
        corpus = validate_corpus(json.loads(path.read_text(encoding="utf-8")), path.parent, training_only=args.training_only)
        (train if args.command == "train" else evaluate)(args, corpus, path.parent)
