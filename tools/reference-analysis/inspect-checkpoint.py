"""Actual-map checkpoint diagnostics; these are training-set checks, not evaluation."""
import argparse
import hashlib
import json
import pathlib

import numpy as np
import onnx
import torch
from PIL import Image, ImageDraw

from corpus import CHANNELS, corpus_fingerprint, validate_corpus
from train import MapTiles, load_model


def inspect(args):
    manifest = pathlib.Path(args.corpus).resolve()
    root = manifest.parent
    corpus = validate_corpus(json.loads(manifest.read_text(encoding='utf-8')), root, training_only=True)
    model, checkpoint = load_model(args.checkpoint, 'cpu')
    if args.auxiliary_corpus:
        auxiliary_path = pathlib.Path(args.auxiliary_corpus)
        auxiliary = validate_corpus(json.loads(auxiliary_path.read_text(encoding='utf-8')), auxiliary_path.parent, training_only=True)
    if not checkpoint.get('trainingOnly') or checkpoint['corpusSha256'] != corpus_fingerprint(manifest, args.auxiliary_corpus):
        raise ValueError('Matching publisher training-only checkpoint required')
    if args.view_corpus == 'auxiliary':
        if not args.auxiliary_corpus:
            raise ValueError('Auxiliary corpus required for auxiliary inspection')
        corpus, root = auxiliary, auxiliary_path.parent
    onnx.checker.check_model(args.onnx)
    output = pathlib.Path(args.output).resolve()
    if output.exists():
        raise ValueError('Diagnostic output exists; preserve prior evidence')
    output.mkdir(parents=True)
    rows = []
    colors = np.array([(240, 20, 20), (180, 0, 220), (0, 200, 200), (0, 100, 255),
                       (255, 140, 0), (0, 170, 0), (30, 30, 30)], dtype=np.float32)
    with torch.no_grad():
        for sheet in corpus['sheets']:
            dataset = MapTiles(root, [sheet])
            if not len(dataset):
                continue
            # Choose a real tile with the most labelled international-border
            # pixels (administrative when no international boundary is present).
            annotation = json.loads((root / sheet['annotations']).read_text(encoding='utf-8'))
            with Image.open(root / annotation['raster']['path']) as source:
                bits = np.asarray(source, dtype=np.uint8)
            channel = next((i for i, name in enumerate(CHANNELS) if annotation['positivePixels'][name]), 3)
            index = max(range(len(dataset)), key=lambda i: int(np.count_nonzero(
                bits[dataset.tiles[i][2]:dataset.tiles[i][2] + 512,
                     dataset.tiles[i][1]:dataset.tiles[i][1] + 512] & (1 << channel))))
            tile, overview, position, target, valid, _ = dataset[index]
            logits = model(tile[None], overview[None], position[None])
            if not torch.isfinite(logits).all():
                raise RuntimeError('Trained checkpoint produced non-finite logits')
            probability = logits.sigmoid()[0].numpy()
            expected = target.numpy() > .5
            known = valid.numpy() > .5
            predicted = probability >= .55
            _, x, y = dataset.tiles[index]
            with Image.open(root / sheet['image']) as source:
                source = source.convert('RGB').crop((x, y, x + 512, y + 512))
            original = np.asarray(source).copy()
            panels = [original]
            for active in [expected, predicted]:
                overlay = original.copy()
                for c in [3, 4, 5, 6, 1, 0]:
                    mask = active[c] & known[c]
                    overlay[mask] = (overlay[mask] * .2 + colors[c] * .8).astype(np.uint8)
                panels.append(overlay)
            canvas = Image.new('RGB', (1536, 540), 'white')
            for i, panel in enumerate(panels):
                canvas.paste(Image.fromarray(panel), (512 * i, 28))
            draw = ImageDraw.Draw(canvas)
            for i, title in enumerate(['Real map input', 'Publisher-derived training target', 'Trained prediction (threshold 0.55)']):
                draw.text((512 * i + 8, 8), title, fill='black')
            canvas.save(output / (sheet['id'] + '.jpg'), quality=95)
            statistics = {}
            for c, name in enumerate(CHANNELS):
                statistics[name] = dict(supervisedPixels=int(known[c].sum()), targetPixels=int((expected[c] & known[c]).sum()),
                                        predictedPixels=int((predicted[c] & known[c]).sum()),
                                        overlapPixels=int((expected[c] & predicted[c] & known[c]).sum()),
                                        probabilityMin=float(probability[c].min()), probabilityMax=float(probability[c].max()))
            rows.append(dict(sheetId=sheet['id'], tileIndex=index, pixelOrigin=[x, y], channels=statistics))
            if len(rows) == 1 and args.view_corpus == 'primary':
                for name, value in [('tile', tile[None]), ('overview', overview[None]), ('position', position[None]), ('expected-logits', logits)]:
                    value.numpy().astype('<f4').tofile(output / (name + '.f32'))
    report = dict(schemaVersion=1, purpose='training-set-diagnostic-only', viewCorpus=args.view_corpus, independentEvaluation=False,
                  releaseApproved=False, checkpointSha256=hashlib.sha256(pathlib.Path(args.checkpoint).read_bytes()).hexdigest(),
                  onnxSha256=hashlib.sha256(pathlib.Path(args.onnx).read_bytes()).hexdigest(),
                  corpusSha256=checkpoint['corpusSha256'], trainingBatches=checkpoint['steps'],
                  optimizerUpdates=checkpoint['optimizerUpdates'],
                  trainingLoss=checkpoint['trainingLoss'], validationLoss=checkpoint['validationLoss'],
                  unobservedChannels=checkpoint['unobservedChannels'], sheets=rows)
    (output / 'diagnostics.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(output=str(output), sheets=len(rows), purpose=report['purpose'])))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for key in ['corpus', 'checkpoint', 'onnx', 'output']:
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--auxiliary-corpus')
    parser.add_argument('--view-corpus', choices=['primary', 'auxiliary'], default='primary')
    args = parser.parse_args()
    torch.set_num_threads(2)
    inspect(args)
