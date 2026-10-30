"""Actual-map checkpoint diagnostics; these are training-set checks, not evaluation."""
import argparse
import hashlib
import json
import pathlib
import struct
import subprocess

import numpy as np
import onnx
import torch
from PIL import Image, ImageDraw

from corpus import CHANNELS, corpus_fingerprint, validate_corpus
from train import MapTiles, load_model
from report_paths import report_argument
from raster import oriented_map_image


def prediction_statistics(probability, expected, known):
    if not isinstance(probability, np.ndarray) or probability.dtype != np.float32 or probability.ndim != 3 or probability.shape[0] != len(CHANNELS):
        raise ValueError('Diagnostic probability must be a seven-channel float32 tensor')
    if expected.shape != probability.shape or known.shape != probability.shape:
        raise ValueError('Diagnostic tensors must have matching dimensions')
    _, height, width = probability.shape
    header = struct.pack('>8sII', b'PDIAG001', width, height)
    payload = header + np.ascontiguousarray(probability, dtype='<f4').tobytes()
    payload += np.ascontiguousarray(expected != 0, dtype=np.uint8).tobytes()
    payload += np.ascontiguousarray(known != 0, dtype=np.uint8).tobytes()
    script = pathlib.Path(__file__).with_name('native-evaluation.mjs')
    result = subprocess.run(['node', str(script), '--diagnostic-stream'], input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('Native diagnostic statistics failed: ' + result.stderr.decode('utf-8', errors='replace'))
    return json.loads(result.stdout)


def inspect(args):
    manifest = pathlib.Path(args.corpus).resolve()
    root = manifest.parent
    corpus = validate_corpus(json.loads(manifest.read_text(encoding='utf-8')), root, training_only=True)
    model, checkpoint = load_model(args.checkpoint, 'cpu')
    baseline, baseline_sha = None, None
    if args.baseline_checkpoint:
        baseline_sha = hashlib.sha256(pathlib.Path(args.baseline_checkpoint).read_bytes()).hexdigest()
        if not checkpoint.get('initialization'):
            raise ValueError('A fresh encoder has no map initializer; compare baselines with frozen-corpus evaluation')
        if checkpoint['initialization']['sha256'] != baseline_sha:
            raise ValueError('Comparison must use the actual initializer checkpoint')
        baseline, _ = load_model(args.baseline_checkpoint, 'cpu')
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
    with torch.no_grad():
        for sheet in corpus['sheets']:
            dataset = MapTiles(root, [sheet])
            if not len(dataset):
                continue
            # Choose a real tile with the most labelled international-border
            # pixels (administrative when no international boundary is present).
            annotation = json.loads((root / sheet['annotations']).read_text(encoding='utf-8'))
            selector = pathlib.Path(__file__).with_name('diagnostic-selection.mjs')
            selected = subprocess.run(['node', str(selector), '--select'],
                input=json.dumps(dict(root=str(root), annotation=annotation)).encode('utf-8'),
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if selected.returncode:
                raise RuntimeError('Native diagnostic tile selection failed: ' + selected.stderr.decode('utf-8', errors='replace'))
            choice = json.loads(selected.stdout)
            if (not isinstance(choice, dict) or not isinstance(choice.get('index'), int)
                    or not 0 <= choice['index'] < len(dataset)
                    or list(dataset.tiles[choice['index']][1:]) != [choice.get('x'), choice.get('y')]):
                raise ValueError('Diagnostic tile selection differs from dataset order')
            index = choice['index']
            tile, overview, position, target, valid, _ = dataset[index]
            logits = model(tile[None], overview[None], position[None])
            if not torch.isfinite(logits).all():
                raise RuntimeError('Trained checkpoint produced non-finite logits')
            probability = logits.sigmoid()[0].numpy()
            prior = None if baseline is None else baseline(tile[None], overview[None], position[None]).sigmoid()[0].numpy()
            if prior is not None and not np.isfinite(prior).all():
                raise RuntimeError('Baseline produced non-finite outputs')
            expected = target.numpy() > .5
            known = valid.numpy() > .5
            predicted = probability >= .55
            _, x, y = dataset.tiles[index]
            with Image.open(root / sheet['image']) as opened:
                source = oriented_map_image(opened).convert('RGB')
            source_tile = Image.new('RGB', (512, 512), 'white')
            source_tile.paste(source.crop((x, y, min(x + 512, source.width), min(y + 512, source.height))), (0, 0))
            original = np.asarray(source_tile).copy()
            active = [expected, *([] if prior is None else [prior >= .55]), predicted]
            header = struct.pack('>8sIII', b'PDPREV01', 512, 512, len(active))
            payload = header + original.tobytes() + np.ascontiguousarray(known, dtype=np.uint8).tobytes()
            payload += b''.join(np.ascontiguousarray(value, dtype=np.uint8).tobytes() for value in active)
            preview_tool = pathlib.Path(__file__).with_name('native-diagnostic-preview.mjs')
            composed = subprocess.run(['node', str(preview_tool), '--overlay-stream'], input=payload,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            if composed.returncode:
                raise RuntimeError('Native diagnostic overlay failed: ' + composed.stderr.decode('utf-8', errors='replace'))
            if len(composed.stdout) != len(active) * 512 * 512 * 3:
                raise ValueError('Invalid diagnostic overlay output length')
            panels = [original, *np.frombuffer(composed.stdout, dtype=np.uint8).reshape(len(active), 512, 512, 3)]
            canvas = Image.new('RGB', (512 * len(panels), 540), 'white')
            for i, panel in enumerate(panels):
                canvas.paste(Image.fromarray(panel), (512 * i, 28))
            draw = ImageDraw.Draw(canvas)
            titles = ['Real map input', 'Source training target', *([] if prior is None else ['Before continuation']), 'Trained prediction (threshold 0.55)']
            for i, title in enumerate(titles):
                draw.text((512 * i + 8, 8), title, fill='black')
            preview = sheet['id'] + '.jpg' if len(rows) < args.maximum_previews else None
            if preview:
                canvas.save(output / preview, quality=95)
            statistics = prediction_statistics(probability, expected, known)
            rows.append(dict(sheetId=sheet['id'], tileIndex=index, pixelOrigin=[x, y], channels=statistics, previewFile=preview,
                             baselineChannels=None if prior is None else prediction_statistics(prior, expected, known)))
            if len(rows) == 1 and args.view_corpus == 'primary':
                for name, value in [('tile', tile[None]), ('overview', overview[None]), ('position', position[None]), ('expected-logits', logits)]:
                    value.numpy().astype('<f4').tofile(output / (name + '.f32'))
    report = dict(schemaVersion=1, purpose='training-set-diagnostic-only', viewCorpus=args.view_corpus, independentEvaluation=False,
                  releaseApproved=False, checkpointSha256=hashlib.sha256(pathlib.Path(args.checkpoint).read_bytes()).hexdigest(),
                  baselineCheckpointSha256=baseline_sha,
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
    parser.add_argument('--baseline-checkpoint')
    parser.add_argument('--maximum-previews', type=int, default=24)
    args = parser.parse_args()
    if not 0 <= args.maximum_previews <= 1024:
        parser.error('Preview budget must be 0..1024')
    for field in vars(args):
        if field in ['corpus', 'auxiliary_corpus', 'checkpoint', 'baseline_checkpoint', 'onnx']:
            setattr(args, field, report_argument(getattr(args, field), access='read', siblings=field in ['corpus', 'auxiliary_corpus']))
    args.output = report_argument(args.output, access='write')
    torch.set_num_threads(2)
    inspect(args)
