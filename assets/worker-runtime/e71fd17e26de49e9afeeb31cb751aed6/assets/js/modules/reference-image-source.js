// Immutable image bytes and decoded crop views have one shared owner. Weak
// decoded entries do not retain pixels after controllers/history release them.
const hashes = new WeakMap(), decoded = new Map(), pending = new Map();

export function normalizeReferenceImageSourceRect(value) {
  if (value == null) return null;
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1) throw new TypeError('Invalid reference source rectangle.');
  return { x, y, width, height };
}

export function referenceImageSourceRect(value, width, height) {
  if (![width, height].every(v => Number.isSafeInteger(v) && v > 0)) throw new TypeError('Invalid source image dimensions.');
  const rect = normalizeReferenceImageSourceRect(value) || { x: 0, y: 0, width, height };
  if (rect.x + rect.width > width || rect.y + rect.height > height) throw new RangeError('Reference source rectangle exceeds image bounds.');
  return rect;
}
export const referenceImageOriginalPixel = (uv, rect) => [rect.x + uv[0] * rect.width, rect.y + uv[1] * rect.height];
export const referenceImageSourceUv = (point, rect) => [(point[0] - rect.x) / rect.width, (point[1] - rect.y) / rect.height];
export const referenceImageSourceSize = image => ({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });

export function referenceImageSourceHash(blob) {
  if (!hashes.has(blob)) hashes.set(blob, blob.arrayBuffer().then(bytes => crypto.subtle.digest('SHA-256', bytes))
    .then(bytes => [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('')));
  return hashes.get(blob);
}

export async function createReferenceImageBitmap(blob, sourceRect, { createBitmap = globalThis.createImageBitmap } = {}) {
  if (typeof createBitmap !== 'function') throw new TypeError('Image bitmap decoder is required.');
  const image = await createBitmap(blob);
  if (!sourceRect) return image;
  try {
    const rect = referenceImageSourceRect(sourceRect, image.width, image.height);
    return await createBitmap(image, rect.x, rect.y, rect.width, rect.height);
  } finally { image.close(); }
}

export async function decodeReferenceImageSource(blob, sourceRect = null) {
  const rect = normalizeReferenceImageSourceRect(sourceRect);
  const key = (await referenceImageSourceHash(blob)) + ':' + JSON.stringify(rect);
  const cached = decoded.get(key)?.deref();
  if (cached) return { image: cached };
  if (!pending.has(key)) {
    const operation = (async () => {
      let image;
      if (rect) {
        const original = (await decodeReferenceImageSource(blob)).image;
        const size = referenceImageSourceSize(original);
        referenceImageSourceRect(rect, size.width, size.height);
        image = document.createElement('canvas');image.width = rect.width;image.height = rect.height;
        image.getContext('2d').drawImage(original, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      } else {
        image = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(blob), element = new Image();element.decoding = 'async';
          element.onload = () => { URL.revokeObjectURL(url);resolve(element); };
          element.onerror = () => { URL.revokeObjectURL(url);reject(new Error('이미지 파일을 읽지 못했습니다.')); };
          element.src = url;
        });
      }
      decoded.delete(key);decoded.set(key, new WeakRef(image));
      while (decoded.size > 32) decoded.delete(decoded.keys().next().value);
      return { image };
    })();
    pending.set(key, operation);
  }
  try { return await pending.get(key); } finally { pending.delete(key); }
}
