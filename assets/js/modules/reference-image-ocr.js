const DEFAULT_LANGUAGES = Object.freeze(['en', 'de', 'fr', 'es', 'it', 'pt', 'nl']);

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

  for (let blockIndex = 0; blockIndex < blocks.length && result.length < limit; blockIndex += 1) {
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
    for (let lineIndex = 0; lineIndex < lines.length && result.length < limit; lineIndex += 1) {
      result.push(Object.freeze({
        id: 'ocr-' + (blockIndex + 1) + '-' + (lineIndex + 1),
        text: lines[lineIndex],
        image,
        confidence,
        box: normalizedBox,
        origin: 'text-detector',
      }));
    }
  }
  return Object.freeze(result);
}

function defaultCanvasFactory(width, height) {
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function defaultDetectorFactory(languages) {
  const Detector = globalThis.TextDetector;
  if (typeof Detector !== 'function' && typeof Detector?.create !== 'function') {
    throw Object.assign(new Error('TextDetector is unavailable'), { code: 'text-detector-unavailable' });
  }
  if (typeof Detector.create === 'function') {
    try {
      return await Detector.create({ languages });
    } catch (error) {
      if (languages?.length) {
        try { return await Detector.create(); } catch {}
      }
      throw error;
    }
  }
  return new Detector();
}

export async function referenceImageOcrAvailability({
  languages = DEFAULT_LANGUAGES,
  Detector = globalThis.TextDetector,
} = {}) {
  if (typeof Detector !== 'function' && typeof Detector?.create !== 'function') {
    return Object.freeze({ available: false, reason: 'text-detector-unavailable' });
  }
  if (typeof Detector.availability !== 'function') {
    return Object.freeze({ available: true, status: 'unknown' });
  }
  try {
    const status = await Detector.availability({ languages: [...languages] });
    const normalized = String(status?.status ?? status ?? '').toLowerCase();
    return Object.freeze({
      available: !['unavailable', 'no'].includes(normalized),
      status: normalized || 'unknown',
    });
  } catch (error) {
    return Object.freeze({
      available: true,
      status: 'unknown',
      warning: String(error?.message || error || ''),
    });
  }
}

export async function detectReferenceImageText(image, {
  languages = DEFAULT_LANGUAGES,
  maxDimension = 2048,
  minimumTextLength = 2,
  maximumDetections = 96,
  detectorFactory = defaultDetectorFactory,
  canvasFactory = defaultCanvasFactory,
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
    const detector = await detectorFactory([...languages]);
    const blocks = await detector.detect(canvas);
    const detections = normalizeReferenceImageOcrBlocks(Array.from(blocks || []), {
      width,
      height,
      minimumTextLength,
      maximumDetections,
    });
    return Object.freeze({
      ok: detections.length > 0,
      reason: detections.length ? '' : 'no-ocr-text',
      provider: 'text-detector',
      width,
      height,
      scale,
      detections,
    });
  } catch (error) {
    const code = error?.code === 'text-detector-unavailable'
      ? error.code
      : 'text-detector-failed';
    return Object.freeze({
      ok: false,
      reason: code,
      error: String(error?.message || error || ''),
      detections: Object.freeze([]),
    });
  }
}

export { DEFAULT_LANGUAGES as REFERENCE_IMAGE_OCR_DEFAULT_LANGUAGES };
