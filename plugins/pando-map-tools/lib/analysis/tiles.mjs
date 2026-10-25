export const REFERENCE_BOUNDARY_CHANNELS = Object.freeze(['international', 'administrative', 'coast', 'hydro', 'transport', 'text', 'frame']);



export function validateReferenceBoundaryTensorContract(manifest) {
  if (manifest?.schemaVersion !== 1 || JSON.stringify(manifest.classes) !== JSON.stringify(REFERENCE_BOUNDARY_CHANNELS)
    || manifest.tileSize !== 512 || manifest.overlap !== 64 || manifest.overviewSize !== 256
    || !/^[\w.-]+\.onnx$/.test(manifest.model?.url || '') || !/^[a-f0-9]{64}$/.test(manifest.model?.sha256 || '')
    || !Number.isInteger(manifest.model?.bytes) || manifest.model.bytes < 1 || manifest.model.bytes > 64 * 1024 * 1024) {
    throw Object.assign(new Error('경계 모델의 현재 입출력 계약이 올바르지 않습니다.'), { code: 'PL-REF-MODEL-CONTRACT' });
  }
  return manifest;
}

export function referenceImageTilePlan(width, height, { tileSize = 512, overlap = 64 } = {}) {
  if (![width, height, tileSize, overlap].every(Number.isInteger) || width < 1 || height < 1 || overlap < 0 || tileSize <= overlap) throw new RangeError('Invalid reference image tile dimensions.');
  const result = [];
  for (let y = 0; y < height; y += tileSize - overlap) for (let x = 0; x < width; x += tileSize - overlap) {
    result.push({ x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) });
  }
  return result;
}

// Keep only one tile-row of probabilities, never seven full-image float masks.
export function createReferenceTileAccumulator(width, height, { tileSize = 512, overlap = 64, threshold = .55, confidenceChannels = [0, 1, 2] } = {}) {
  const channels = REFERENCE_BOUNDARY_CHANNELS.length;
  let baseY = 0, flushed = 0;
  const probabilities = new Float32Array(channels * tileSize * width), weights = new Float32Array(tileSize * width);
  const labels = new Uint8Array(width * height), confidence = new Float32Array(width * height);
  return {
    add(tile, logits) {
      if (tile.y !== baseY || logits.length !== channels * tileSize * tileSize) throw new RangeError('Out-of-order reference tile.');
      for (let y = 0; y < tile.height; y++) for (let x = 0; x < tile.width; x++) {
        const i = y * width + tile.x + x;
        const weight = Math.min(1, (x + 1) / Math.max(1, overlap), (tile.width - x) / Math.max(1, overlap), (y + 1) / Math.max(1, overlap), (tile.height - y) / Math.max(1, overlap));
        weights[i] += weight;
        for (let channel = 0; channel < channels; channel++) {
          const logit = logits[channel * tileSize * tileSize + y * tileSize + x];
          if (!Number.isFinite(logit)) throw new Error('Non-finite reference model output.');
          probabilities[channel * tileSize * width + i] += weight / (1 + Math.exp(-logit));
        }
      }
    },
    finishRow(y, nextY) {
      if (y !== baseY || nextY <= y || nextY > height || nextY - y > tileSize) throw new RangeError('Invalid reference row flush.');
      const count = nextY - y, shift = count * width;
      for (let row = 0; row < count; row++) for (let x = 0; x < width; x++) {
        const local = row * width + x, target = (y + row) * width + x;
        if (!(weights[local] > 0)) throw new Error('Uncovered reference image pixel.');
        for (let channel = 0; channel < channels; channel++) {
          const probability = probabilities[channel * tileSize * width + local] / weights[local];
          if (probability >= threshold) labels[target] |= 1 << channel;
          if (confidenceChannels.includes(channel)) confidence[target] = Math.max(confidence[target], probability);
        }
      }
      for (let channel = 0; channel < channels; channel++) {
        const start = channel * tileSize * width, end = start + tileSize * width;
        probabilities.copyWithin(start, start + shift, end); probabilities.fill(0, end - shift, end);
      }
      weights.copyWithin(0, shift); weights.fill(0, weights.length - shift);
      baseY = nextY; flushed += count;
    },
    result() {
      if (flushed !== height) throw new Error('Reference image tile rows remain unfinished.');
      return { labels, confidence };
    },
  };
}
