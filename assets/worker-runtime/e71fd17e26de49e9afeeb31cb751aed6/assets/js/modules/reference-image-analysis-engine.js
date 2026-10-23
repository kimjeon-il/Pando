import { createReferenceOcrDetector } from './reference-image-ocr-runtime.js';
import { createReferenceImageBitmap } from './reference-image-source.js';
import { detectReferenceMapLayout } from './reference-image-layout.js';
import { detectReferenceGraticule } from './reference-image-grid.js';
import { normalizeReferenceImageOcrBlocks } from './reference-image-ocr.js';
import { findReferenceImagePointSymbolNearTextBox } from './reference-image-auto-georef.js';
import { referenceImageTilePlan, createReferenceTileAccumulator, validateReferenceBoundaryManifest } from './reference-image-analysis-tiles.js';

const fail = (message, code) => Object.assign(new Error(message), { code, category: 'OPERATION' });
const sourceLimit = 16 * 1024 * 1024;

export async function analyzeReferenceMapLayout(payload, context) {
  context.throwIfCancelled();
  const image = await createReferenceImageBitmap(payload.blob, payload.sourceRect);
  try {
    if (image.width * image.height > sourceLimit) throw fail('자동 분석은 현재 16MP 이하 이미지를 지원합니다.', 'PL-REF-IMAGE-BUDGET');
    const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
    const drawing = canvas.getContext('2d', { willReadFrequently: true });
    drawing.fillStyle = '#fff';drawing.fillRect(0, 0, canvas.width, canvas.height);drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    const detector = await createReferenceOcrDetector(payload.languages || null, { ...payload.resources, signal: context.signal });
    const blocks = await detector.detect(await canvas.convertToBlob({ type: 'image/png' }));
    context.throwIfCancelled();
    const raster = drawing.getImageData(0, 0, canvas.width, canvas.height);
    const result = detectReferenceMapLayout(raster, { blocks });
    const offset = payload.sourceRect || { x: 0, y: 0 };
    return { ...result, grid: detectReferenceGraticule(raster, blocks), width: image.width, height: image.height, panels: result.panels.map(panel => {
      const r = panel.sourceRect, x = Math.round(r.x * image.width / canvas.width), y = Math.round(r.y * image.height / canvas.height);
      return { ...panel, sourceRect: { x: x + offset.x, y: y + offset.y,
        width: Math.min(image.width - x, Math.round(r.width * image.width / canvas.width)),
        height: Math.min(image.height - y, Math.round(r.height * image.height / canvas.height)) } };
    }) };
  } finally { image.close(); }
}

export async function recognizeReferenceMap(payload, context) {
  context.throwIfCancelled();
  const image = await createReferenceImageBitmap(payload.blob, payload.sourceRect);
  try {
    if (image.width * image.height > sourceLimit) throw fail('자동 분석은 현재 16MP 이하 이미지를 지원합니다.', 'PL-REF-IMAGE-BUDGET');
    const detector = await createReferenceOcrDetector(payload.languages || null, { ...payload.resources, signal: context.signal });
    const overviewScale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const overview = new OffscreenCanvas(Math.max(1, Math.round(image.width * overviewScale)), Math.max(1, Math.round(image.height * overviewScale)));
    overview.getContext('2d').drawImage(image, 0, 0, overview.width, overview.height);
    const orientation = await detector.analyze(overview);
    const rows = [];
    for (const tile of referenceImageTilePlan(image.width, image.height, { tileSize: 2048, overlap: 128 })) {
      context.throwIfCancelled();
      const canvas = new OffscreenCanvas(tile.width, tile.height), drawing = canvas.getContext('2d');
      drawing.fillStyle = '#fff';drawing.fillRect(0, 0, tile.width, tile.height);
      drawing.drawImage(image, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
      const blocks = await detector.detect(await canvas.convertToBlob({ type: 'image/png' }));
      for (const block of blocks) rows.push({ ...block, boundingBox: { ...block.boundingBox, x: block.boundingBox.x + tile.x, y: block.boundingBox.y + tile.y } });
    }
    const detections = normalizeReferenceImageOcrBlocks(rows, { width: image.width, height: image.height, maximumDetections: 256 });
    const ratio = Math.min(1, 2048 / Math.max(image.width, image.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)));
    const drawing = canvas.getContext('2d', { willReadFrequently: true });
    drawing.fillStyle = '#fff';drawing.fillRect(0, 0, canvas.width, canvas.height);drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    const raster = drawing.getImageData(0, 0, canvas.width, canvas.height);
    const unique = [];
    for (const detection of detections) {
      context.throwIfCancelled();
      const symbol = findReferenceImagePointSymbolNearTextBox(raster, detection.box, { searchRadiusPx: 32, minimumConfidence: .4 });
      unique.push({ ...detection, symbol });
    }
    return { ok: unique.length > 0, reason: unique.length ? '' : 'no-ocr-text', provider: 'tesseract', orientation, detections: unique, width: image.width, height: image.height };
  } finally { image.close(); }
}

async function readModel(resources) {
  const url = new URL('boundary.manifest.json', resources.dataBase);
  const response = await fetch(url);
  // The native asset server returns its HTML entry for an absent local path.
  // Treat that response as an unavailable model, before parsing or loading OCR.
  if (!response.ok || /^text\/html\b/iu.test(response.headers.get('Content-Type') || '')) {
    throw fail('경계 추출용 학습 모델이 아직 준비되지 않았습니다.', 'PL-REF-MODEL-MISSING');
  }
  let parsed;
  try { parsed = await response.json(); }
  catch (cause) { throw Object.assign(fail('경계 모델 정보를 읽지 못했습니다.', 'PL-REF-MODEL-MANIFEST'), { cause }); }
  const manifest = validateReferenceBoundaryManifest(parsed);
  const modelResponse = await fetch(new URL(manifest.model.url, url));
  if (!modelResponse.ok || Number(modelResponse.headers.get('Content-Length')) > manifest.model.bytes) throw fail('경계 모델 파일을 읽지 못했습니다.', 'PL-REF-MODEL-ASSET');
  const bytes = await modelResponse.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== manifest.model.bytes || digest !== manifest.model.sha256) throw fail('경계 모델의 버전 또는 해시가 일치하지 않습니다.', 'PL-REF-MODEL-HASH');
  return { manifest, bytes };
}

function imageTensor(canvas, ort) {
  const { data, width, height } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const values = new Float32Array(3 * width * height), mean = [.485, .456, .406], deviation = [.229, .224, .225];
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) values[c * width * height + i] = (data[4 * i + c] / 255 - mean[c]) / deviation[c];
  return new ort.Tensor('float32', values, [1, 3, height, width]);
}

export async function extractReferenceMapBoundaries(payload, context, core) {
  const { manifest, bytes } = await readModel(payload.resources);
  context.throwIfCancelled();
  const onnxRuntimeUrl = new URL('ort.wasm.min.mjs', payload.resources.assetBase);
  const ort = await import(onnxRuntimeUrl.href);
  ort.env.wasm.wasmPaths = payload.resources.assetBase;ort.env.wasm.numThreads = 1;ort.env.wasm.proxy = false;
  const image = await createReferenceImageBitmap(payload.blob, payload.sourceRect);
  let session = null;
  try {
    if (image.width * image.height > sourceLimit) throw fail('자동 분석은 현재 16MP 이하 이미지를 지원합니다.', 'PL-REF-IMAGE-BUDGET');
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    const overview = new OffscreenCanvas(256, 256), overviewContext = overview.getContext('2d');
    overviewContext.fillStyle = '#fff';overviewContext.fillRect(0, 0, 256, 256);overviewContext.drawImage(image, 0, 0, 256, 256);
    const overviewTensor = imageTensor(overview, ort);
    const tileCanvas = new OffscreenCanvas(512, 512), drawing = tileCanvas.getContext('2d');
    let accumulator = createReferenceTileAccumulator(image.width, image.height), currentY = 0;
    const plan = referenceImageTilePlan(image.width, image.height);
    try {
      for (let i = 0; i < plan.length; i++) {
        context.throwIfCancelled();
        const tile = plan[i];
        if (tile.y !== currentY) { accumulator.finishRow(currentY, tile.y); currentY = tile.y; }
        drawing.fillStyle = '#fff';drawing.fillRect(0, 0, 512, 512);
        drawing.drawImage(image, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height);
        const tensor = imageTensor(tileCanvas, ort), position = new ort.Tensor('float32', Float32Array.from([tile.x / image.width, tile.y / image.height, tile.width / image.width, tile.height / image.height]), [1, 4]);
        let output;
        try {
          output = await session.run({ tile: tensor, overview: overviewTensor, position });
          if (!output.logits || JSON.stringify(output.logits.dims) !== '[1,7,512,512]') throw fail('경계 모델 출력 크기가 올바르지 않습니다.', 'PL-REF-MODEL-OUTPUT');
          accumulator.add(tile, output.logits.data);
        } finally {
          tensor.dispose();position.dispose();
          for (const value of Object.values(output || {})) value.dispose();
        }
        context.emitEvent('reference.analysis-progress', { phase: 'boundaries', completed: i + 1, total: plan.length });
      }
      accumulator.finishRow(currentY, image.height);
    } finally { overviewTensor.dispose(); }
    const mask = accumulator.result();accumulator = null;
    await session.release();session = null;
    context.throwIfCancelled();
    const graph = core.referenceBoundaryGraph(image.width, image.height, mask.labels, mask.confidence, { threshold: .55, simplifyTolerance: .75 });
    context.throwIfCancelled();
    return { graph, modelVersion: manifest.model.sha256, evaluationStatus: manifest.evaluationStatus };
  } finally { if (session) await session.release();image.close(); }
}
