const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function finitePair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function rasterIndex(raster, x, y) {
  return y * raster.width + x;
}

function validRaster(raster) {
  return !!raster
    && Number.isInteger(raster.width)
    && Number.isInteger(raster.height)
    && raster.width > 0
    && raster.height > 0
    && raster.luma?.length === raster.width * raster.height;
}

function medianLuma(raster, left, top, right, bottom) {
  const histogram = new Uint32Array(256);
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      histogram[raster.luma[rasterIndex(raster, x, y)]] += 1;
      count += 1;
    }
  }
  if (!count) return 255;
  const target = Math.floor(count / 2);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative > target) return value;
  }
  return 255;
}

function connectedComponents(raster, bounds, accepts, {
  maxComponentPixels = 140,
  maxDiameter = 14,
  excludeBoxPx = null,
} = {}) {
  const { left, top, right, bottom } = bounds;
  const width = right - left + 1;
  const height = bottom - top + 1;
  const visited = new Uint8Array(width * height);
  const components = [];
  const localIndex = (x, y) => (y - top) * width + (x - left);
  const queueX = [];
  const queueY = [];

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const local = localIndex(x, y);
      if (visited[local]) continue;
      visited[local] = 1;
      const first = raster.luma[rasterIndex(raster, x, y)];
      if (!accepts(first)) continue;

      queueX.length = 0;
      queueY.length = 0;
      queueX.push(x);
      queueY.push(y);
      let cursor = 0;
      let pixels = 0;
      let sumX = 0;
      let sumY = 0;
      let sumLuma = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let overflow = false;

      while (cursor < queueX.length) {
        const px = queueX[cursor];
        const py = queueY[cursor];
        cursor += 1;
        pixels += 1;
        sumX += px;
        sumY += py;
        sumLuma += raster.luma[rasterIndex(raster, px, py)];
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);

        if (
          pixels > maxComponentPixels
          || maxX - minX + 1 > maxDiameter
          || maxY - minY + 1 > maxDiameter
        ) {
          overflow = true;
        }

        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = px + dx;
            const ny = py + dy;
            if (nx < left || nx > right || ny < top || ny > bottom) continue;
            const nextLocal = localIndex(nx, ny);
            if (visited[nextLocal]) continue;
            visited[nextLocal] = 1;
            if (!accepts(raster.luma[rasterIndex(raster, nx, ny)])) continue;
            queueX.push(nx);
            queueY.push(ny);
          }
        }
      }

      if (!overflow && pixels > 0) {
        components.push({
          pixels,
          center: [sumX / pixels, sumY / pixels],
          meanLuma: sumLuma / pixels,
          bounds: [minX, minY, maxX, maxY],
        });
      }
    }
  }
  return components;
}

function scoreComponent(component, expected, background, searchRadius, polarity, {
  minPixels = 3,
  maxPixels = 140,
  minAspect = 0.42,
  targetDiameter = 5,
} = {}) {
  if (component.pixels < minPixels || component.pixels > maxPixels) return null;
  const [minX, minY, maxX, maxY] = component.bounds;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const aspect = Math.min(width, height) / Math.max(width, height);
  if (!Number.isFinite(aspect) || aspect < minAspect) return null;
  const area = width * height;
  const fill = clamp(component.pixels / Math.max(1, area), 0, 1);
  const distance = Math.hypot(component.center[0] - expected[0], component.center[1] - expected[1]);
  if (distance > searchRadius) return null;

  const rawContrast = polarity === 'dark'
    ? background - component.meanLuma
    : component.meanLuma - background;
  if (rawContrast <= 0) return null;

  const contrastScore = clamp(rawContrast / 96, 0, 1);
  const compactness = clamp(aspect * Math.min(1, fill / 0.45), 0, 1);
  const distanceScore = 1 - clamp(distance / Math.max(1, searchRadius), 0, 1);
  const diameter = Math.sqrt(Math.max(1, area));
  const sizeScore = Math.exp(-Math.abs(diameter - targetDiameter) / Math.max(2, targetDiameter));
  const confidence = clamp(
    contrastScore * 0.34
      + compactness * 0.34
      + distanceScore * 0.24
      + sizeScore * 0.08,
    0,
    1,
  );
  return { confidence, distance, width, height, fill, contrast: rawContrast, polarity };
}


const DEFAULT_PLACE_KINDS = new Set(['capital', 'city', 'town']);

export function buildReferenceImagePlaceSeeds(places = [], {
  projectCoordinate,
  hitTestUv,
  kinds = DEFAULT_PLACE_KINDS,
  maximumSeeds = 120,
  edgeInset = 0.015,
} = {}) {
  if (!Array.isArray(places) || typeof projectCoordinate !== 'function' || typeof hitTestUv !== 'function') {
    return Object.freeze([]);
  }
  const allowedKinds = kinds instanceof Set ? kinds : new Set(kinds || []);
  const ranked = places
    .filter(place => allowedKinds.has(String(place?.kind || '')))
    .map(place => ({
      place,
      priority: Number.isFinite(Number(place?.priority)) ? Number(place.priority) : 0,
      population: Number.isFinite(Number(place?.population)) ? Number(place.population) : 0,
    }))
    .sort((left, right) => right.priority - left.priority
      || right.population - left.population
      || String(left.place?.id || '').localeCompare(String(right.place?.id || '')));

  const limit = Math.max(1, Math.min(512, Math.round(Number(maximumSeeds) || 120)));
  const inset = clamp(Number(edgeInset) || 0, 0, 0.2);
  const seeds = [];
  for (const item of ranked) {
    const coordinate = finitePair(item.place?.coordinates);
    if (!coordinate) continue;
    const screen = finitePair(projectCoordinate(coordinate));
    if (!screen) continue;
    const expectedUv = finitePair(hitTestUv(screen));
    if (!expectedUv) continue;
    if (
      expectedUv[0] < inset || expectedUv[0] > 1 - inset
      || expectedUv[1] < inset || expectedUv[1] > 1 - inset
    ) continue;
    seeds.push(Object.freeze({
      id: String(item.place.id || ''),
      name: String(item.place.name || ''),
      kind: String(item.place.kind || ''),
      coordinate: Object.freeze([coordinate[0], coordinate[1]]),
      expectedUv: Object.freeze([expectedUv[0], expectedUv[1]]),
      priority: item.priority,
      population: item.population,
    }));
    if (seeds.length >= limit) break;
  }
  return Object.freeze(seeds);
}

export function findReferenceImagePointSymbol(raster, expectedUv, {
  searchRadiusPx = 28,
  minimumContrast = 28,
  minimumConfidence = 0.42,
  maxComponentPixels = 140,
  maxDiameter = 14,
  excludeBoxPx = null,
} = {}) {
  if (!validRaster(raster)) return null;
  const uv = finitePair(expectedUv);
  if (!uv) return null;
  const expected = [
    clamp(uv[0], 0, 1) * Math.max(1, raster.width - 1),
    clamp(uv[1], 0, 1) * Math.max(1, raster.height - 1),
  ];
  const searchRadius = Math.max(4, Math.round(Number(searchRadiusPx) || 28));
  const left = Math.max(0, Math.floor(expected[0] - searchRadius));
  const top = Math.max(0, Math.floor(expected[1] - searchRadius));
  const right = Math.min(raster.width - 1, Math.ceil(expected[0] + searchRadius));
  const bottom = Math.min(raster.height - 1, Math.ceil(expected[1] + searchRadius));
  const background = medianLuma(raster, left, top, right, bottom);
  const contrast = Math.max(8, Number(minimumContrast) || 28);
  const bounds = { left, top, right, bottom };
  const polarities = [
    ['dark', value => value <= background - contrast],
    ['light', value => value >= background + contrast],
  ];

  let best = null;
  for (const [polarity, accepts] of polarities) {
    const components = connectedComponents(raster, bounds, accepts, {
      maxComponentPixels,
      maxDiameter,
    });
    for (const component of components) {
      if (Array.isArray(excludeBoxPx) && excludeBoxPx.length === 4) {
        const [exLeft, exTop, exRight, exBottom] = excludeBoxPx.map(Number);
        const center = component.center;
        if (
          center[0] >= exLeft && center[0] <= exRight
          && center[1] >= exTop && center[1] <= exBottom
        ) continue;
      }
      const score = scoreComponent(component, expected, background, searchRadius, polarity, {
        maxPixels: maxComponentPixels,
      });
      if (!score || score.confidence < minimumConfidence) continue;
      if (!best
        || score.confidence > best.confidence + 1e-9
        || (Math.abs(score.confidence - best.confidence) <= 1e-9 && score.distance < best.distance)) {
        best = { ...component, ...score };
      }
    }
  }
  if (!best) return null;
  return Object.freeze({
    uv: Object.freeze([
      clamp(best.center[0] / Math.max(1, raster.width - 1), 0, 1),
      clamp(best.center[1] / Math.max(1, raster.height - 1), 0, 1),
    ]),
    pixel: Object.freeze([best.center[0], best.center[1]]),
    expectedPixel: Object.freeze(expected),
    confidence: best.confidence,
    distancePixels: best.distance,
    polarity: best.polarity,
    componentPixels: best.pixels,
    componentBounds: Object.freeze([...best.bounds]),
    contrast: best.contrast,
  });
}


export function findReferenceImagePointSymbolNearTextBox(raster, normalizedBox, {
  searchRadiusPx = 24,
  exclusionPaddingPx = 2,
  minimumConfidence = 0.42,
} = {}) {
  if (!validRaster(raster) || !Array.isArray(normalizedBox) || normalizedBox.length !== 4) return null;
  const values = normalizedBox.map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [u, v, uw, vh] = values;
  const left = clamp(u, 0, 1) * Math.max(1, raster.width - 1);
  const top = clamp(v, 0, 1) * Math.max(1, raster.height - 1);
  const right = clamp(u + uw, 0, 1) * Math.max(1, raster.width - 1);
  const bottom = clamp(v + vh, 0, 1) * Math.max(1, raster.height - 1);
  if (right <= left || bottom <= top) return null;

  const radius = Math.max(8, Math.round(Number(searchRadiusPx) || 24));
  const pad = Math.max(0, Number(exclusionPaddingPx) || 0);
  const exclusion = [left - pad, top - pad, right + pad, bottom + pad];
  const offset = Math.max(5, Math.min(radius * 0.5, Math.max(7, Math.min(right - left, bottom - top) * 0.55)));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const probes = [
    [left - offset, cy],
    [right + offset, cy],
    [cx, top - offset],
    [cx, bottom + offset],
    [left - offset * 0.7, top - offset * 0.7],
    [right + offset * 0.7, top - offset * 0.7],
    [left - offset * 0.7, bottom + offset * 0.7],
    [right + offset * 0.7, bottom + offset * 0.7],
  ];

  let best = null;
  for (const pixel of probes) {
    const expectedUv = [
      clamp(pixel[0] / Math.max(1, raster.width - 1), 0, 1),
      clamp(pixel[1] / Math.max(1, raster.height - 1), 0, 1),
    ];
    const symbol = findReferenceImagePointSymbol(raster, expectedUv, {
      searchRadiusPx: radius,
      minimumConfidence,
      excludeBoxPx: exclusion,
    });
    if (!symbol) continue;

    const dx = symbol.pixel[0] < left ? left - symbol.pixel[0]
      : symbol.pixel[0] > right ? symbol.pixel[0] - right : 0;
    const dy = symbol.pixel[1] < top ? top - symbol.pixel[1]
      : symbol.pixel[1] > bottom ? symbol.pixel[1] - bottom : 0;
    const boxDistance = Math.hypot(dx, dy);
    const adjustedConfidence = clamp(
      symbol.confidence * 0.88 + (1 - clamp(boxDistance / (radius * 1.5), 0, 1)) * 0.12,
      0,
      1,
    );
    const candidate = Object.freeze({ ...symbol, confidence: adjustedConfidence, boxDistancePixels: boxDistance });
    if (!best
      || candidate.confidence > best.confidence + 1e-9
      || (Math.abs(candidate.confidence - best.confidence) <= 1e-9
        && candidate.boxDistancePixels < best.boxDistancePixels)) {
      best = candidate;
    }
  }
  return best;
}

export function buildReferenceImagePlaceSymbolCandidates(raster, seeds = [], {
  searchRadiusPx = 28,
  minimumConfidence = 0.42,
  dedupeRadiusPx = 4,
  maximumCandidates = 96,
} = {}) {
  if (!validRaster(raster) || !Array.isArray(seeds)) {
    return Object.freeze({ candidates: Object.freeze([]), misses: Object.freeze([]), examined: 0 });
  }

  const hits = [];
  const misses = [];
  for (const seed of seeds) {
    const expectedUv = finitePair(seed?.expectedUv);
    const coordinate = finitePair(seed?.coordinate || seed?.coordinates);
    if (!expectedUv || !coordinate) continue;
    const symbol = findReferenceImagePointSymbol(raster, expectedUv, {
      searchRadiusPx,
      minimumConfidence,
    });
    if (!symbol) {
      misses.push(Object.freeze({ id: String(seed.id || ''), name: String(seed.name || '') }));
      continue;
    }
    const priority = Number(seed.priority);
    const ranking = Number.isFinite(priority) ? clamp(priority / 100, 0, 1) : 0.5;
    hits.push({
      id: String(seed.id || ''),
      name: String(seed.name || ''),
      image: symbol.uv,
      coordinate: Object.freeze([coordinate[0], coordinate[1]]),
      confidence: clamp(symbol.confidence * 0.9 + ranking * 0.1, 0, 1),
      symbol,
      origin: 'place-symbol',
      kind: String(seed.kind || ''),
    });
  }

  hits.sort((left, right) => right.confidence - left.confidence
    || right.symbol.contrast - left.symbol.contrast
    || left.id.localeCompare(right.id));

  const accepted = [];
  const radiusSquared = Math.max(0, Number(dedupeRadiusPx) || 4) ** 2;
  for (const hit of hits) {
    const duplicate = accepted.some(existing => {
      const dx = hit.symbol.pixel[0] - existing.symbol.pixel[0];
      const dy = hit.symbol.pixel[1] - existing.symbol.pixel[1];
      return dx * dx + dy * dy <= radiusSquared;
    });
    if (duplicate) {
      misses.push(Object.freeze({ id: hit.id, name: hit.name, reason: 'duplicate-symbol' }));
      continue;
    }
    accepted.push(hit);
    if (accepted.length >= Math.max(1, Math.round(Number(maximumCandidates) || 96))) break;
  }

  const candidates = accepted.map(hit => Object.freeze({
    id: hit.id,
    name: hit.name,
    image: hit.image,
    coordinate: hit.coordinate,
    confidence: hit.confidence,
    origin: hit.origin,
    kind: hit.kind,
    symbol: hit.symbol,
  }));
  return Object.freeze({
    candidates: Object.freeze(candidates),
    misses: Object.freeze(misses),
    examined: seeds.length,
  });
}

export function createReferenceImagePointRaster(image, { maxDimension = 1600 } = {}) {
  const sourceWidth = Number(image?.naturalWidth || image?.width || 0);
  const sourceHeight = Number(image?.naturalHeight || image?.height || 0);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new TypeError('Reference image dimensions are unavailable');
  }
  const limit = Math.max(256, Math.min(4096, Math.round(Number(maxDimension) || 1600)));
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Reference image analysis canvas is unavailable');
  context.drawImage(image, 0, 0, width, height);
  return referenceImagePointRasterFromRgba(context.getImageData(0, 0, width, height), { sourceWidth, sourceHeight, scale });
}

export function referenceImagePointRasterFromRgba({ width, height, data: pixels }, { sourceWidth = width, sourceHeight = height, scale = 1 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || pixels.length !== width * height * 4) throw new TypeError('Invalid point raster RGBA pixels.');
  const luma = new Uint8Array(width * height);
  for (let source = 0, target = 0; source < pixels.length; source += 4, target += 1) {
    luma[target] = Math.round(
      pixels[source] * 0.2126
      + pixels[source + 1] * 0.7152
      + pixels[source + 2] * 0.0722,
    );
  }
  return Object.freeze({
    width,
    height,
    sourceWidth,
    sourceHeight,
    scale,
    luma,
  });
}
