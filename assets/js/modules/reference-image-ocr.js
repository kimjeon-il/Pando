import { createReferenceOcrDetector, REFERENCE_OCR_LANGUAGES } from './reference-image-ocr-runtime.js';
const DEFAULT_LANGUAGES = REFERENCE_OCR_LANGUAGES;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function imageDimensions(image) {
  const width = finite(image?.naturalWidth ?? image?.videoWidth ?? image?.width);
  const height = finite(image?.naturalHeight ?? image?.videoHeight ?? image?.height);
  return width && height && width > 0 && height > 0 ? [width, height] : null;
}

function normalizeBox(value, width, height) {
  const x = finite(value?.x);
  const y = finite(value?.y);
  const boxWidth = finite(value?.width);
  const boxHeight = finite(value?.height);
  if ([x, y, boxWidth, boxHeight].some(item => item === null)) return null;
  if (boxWidth <= 0 || boxHeight <= 0) return null;
  const left = clamp(x, 0, width);
  const top = clamp(y, 0, height);
  const right = clamp(x + boxWidth, 0, width);
  const bottom = clamp(y + boxHeight, 0, height);
  if (right <= left || bottom <= top) return null;
  return [left, top, right - left, bottom - top];
}

function plausibleText(value, minimumLength) {
  const text = String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if ([...text].length < minimumLength || [...text].length > 96) return '';
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  return text;
}

export function normalizeReferenceImageOcrBlocks(blocks = [], {
  width,
  height,
  minimumTextLength = 2,
  maximumDetections = 96,
} = {}) {
  const imageWidth = finite(width);
  const imageHeight = finite(height);
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0 || !Array.isArray(blocks)) {
    return Object.freeze([]);
  }
  const limit = Math.max(1, Math.min(512, Math.round(Number(maximumDetections) || 96)));
  const minimum = Math.max(1, Math.min(12, Math.round(Number(minimumTextLength) || 2)));
  const result = [];
  const nearby = new Map();

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const box = normalizeBox(block?.boundingBox || block?.box, imageWidth, imageHeight);
    if (!box) continue;
    const raw = String(block?.rawValue ?? block?.text ?? '');
    const lines = raw.split(/[\r\n]+/u).map(line => plausibleText(line, minimum)).filter(Boolean);
    if (!lines.length) continue;
    const [x, y, boxWidth, boxHeight] = box;
    const image = Object.freeze([
      clamp((x + boxWidth / 2) / imageWidth, 0, 1),
      clamp((y + boxHeight / 2) / imageHeight, 0, 1),
    ]);
    const normalizedBox = Object.freeze([
      clamp(x / imageWidth, 0, 1),
      clamp(y / imageHeight, 0, 1),
      clamp(boxWidth / imageWidth, 0, 1),
      clamp(boxHeight / imageHeight, 0, 1),
    ]);
    const confidence = clamp(finite(block?.confidence) ?? 1, 0, 1);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const row = Object.freeze({
        id: 'ocr-' + (blockIndex + 1) + '-' + (lineIndex + 1),
        text: lines[lineIndex],
        originalText: raw,
        image,
        confidence,
        box: normalizedBox,
        origin: 'tesseract',
      });
      const text = row.text.toLocaleLowerCase(), gx = Math.floor(image[0] * 200), gy = Math.floor(image[1] * 200);
      let duplicate = -1;
      for (let dx = -1; dx <= 1 && duplicate < 0; dx++) for (let dy = -1; dy <= 1 && duplicate < 0; dy++) {
        for (const index of nearby.get(`${text}:${gx + dx}:${gy + dy}`) || []) {
          const old = result[index];
          if (Math.hypot(old.image[0] - image[0], old.image[1] - image[1]) < .005) { duplicate = index;break; }
        }
      }
      if (duplicate >= 0) {
        if (row.confidence > result[duplicate].confidence) {
          const old = result[duplicate], oldKey = `${text}:${Math.floor(old.image[0] * 200)}:${Math.floor(old.image[1] * 200)}`;
          const key = `${text}:${gx}:${gy}`;
          if (key !== oldKey) {
            nearby.set(oldKey, nearby.get(oldKey).filter(index => index !== duplicate));
            if (!nearby.has(key)) nearby.set(key, []);
            nearby.get(key).push(duplicate);
          }
          result[duplicate] = row;
        }
      } else {
        const key = `${text}:${gx}:${gy}`;
        if (!nearby.has(key)) nearby.set(key, []);
        nearby.get(key).push(result.length);result.push(row);
      }
    }
  }
  // Round-robin spatial bins prevent the first tile or language pass from
  // exhausting the control budget. Confidence orders alternatives within a bin.
  const columns = Math.max(1, Math.min(limit, Math.ceil(Math.sqrt(limit * imageWidth / imageHeight))));
  const rows = Math.ceil(limit / columns), bins = new Map();
  for (const row of result) {
    const key = Math.min(columns - 1, Math.floor(row.image[0] * columns)) + columns * Math.min(rows - 1, Math.floor(row.image[1] * rows));
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(row);
  }
  for (const bin of bins.values()) bin.sort((a, b) => b.confidence - a.confidence);
  const selected = [];
  const count = Math.min(result.length, limit);
  for (let depth = 0; selected.length < count; depth++) for (const bin of bins.values()) {
    if (bin[depth]) selected.push(bin[depth]);
    if (selected.length === count) break;
  }
  return Object.freeze(selected);
}

function defaultCanvasFactory(width, height) {
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function referenceImageOcrAvailability({
  fetchManifest = async () => {
    const response = await fetch(new URL('../../vendor/reference-analysis/manifest.json', import.meta.url));
    if (!response.ok) throw new Error('Bundled OCR runtime is missing.');
    return response.json();
  },
} = {}) {
  try {
    const manifest = await fetchManifest();
    const available = manifest.schemaVersion === 1 && DEFAULT_LANGUAGES.every(language => manifest.languages?.[language]?.sha256);
    return Object.freeze({ available, status: available ? 'ready' : 'missing-language-pack', provider: 'tesseract' });
  } catch (error) {
    return Object.freeze({ available: false, reason: 'ocr-runtime-unavailable', error: String(error.message || error) });
  }
}

export async function detectReferenceImageText(image, {
  languages = null,
  maxDimension = 2048,
  minimumTextLength = 2,
  maximumDetections = 96,
  detectorFactory = createReferenceOcrDetector,
  canvasFactory = defaultCanvasFactory,
  signal = null,
} = {}) {
  const dimensions = imageDimensions(image);
  if (!dimensions) {
    return Object.freeze({ ok: false, reason: 'invalid-image', detections: Object.freeze([]) });
  }
  const [sourceWidth, sourceHeight] = dimensions;
  const limit = Math.max(256, Math.min(4096, Math.round(Number(maxDimension) || 2048)));
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  let canvas;
  try {
    canvas = canvasFactory(width, height);
    const context = canvas?.getContext?.('2d', { willReadFrequently: false });
    if (!context) throw new Error('OCR canvas is unavailable');
    context.drawImage(image, 0, 0, width, height);
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: 'ocr-canvas-unavailable',
      error: String(error?.message || error || ''),
      detections: Object.freeze([]),
    });
  }

  try {
    signal?.throwIfAborted();
    const detector = await detectorFactory(languages ? [...languages] : null, { signal });
    const blocks = await detector.detect(canvas);
    signal?.throwIfAborted();
    const detections = normalizeReferenceImageOcrBlocks(Array.from(blocks || []), {
      width,
      height,
      minimumTextLength,
      maximumDetections,
    });
    return Object.freeze({
      ok: detections.length > 0,
      reason: detections.length ? '' : 'no-ocr-text',
      provider: 'tesseract',
      width,
      height,
      scale,
      detections,
    });
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const code = error?.code || 'ocr-recognition-failed';
    return Object.freeze({
      ok: false,
      reason: code,
      error: String(error?.message || error || ''),
      detections: Object.freeze([]),
    });
  }
}

export { DEFAULT_LANGUAGES as REFERENCE_IMAGE_OCR_DEFAULT_LANGUAGES };
