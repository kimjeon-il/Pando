'use strict';
const assetRevision = new URL(self.location.href).searchParams.get('v') || '';
importScripts(...['../vendor/d3.min.js', './geographic-boundary-core.js', './canvas-scene-composition-core.js', './canvas-terrain-dem-core.js']
  .map(path => { const url = new URL(path, self.location.href); url.searchParams.set('v', assetRevision); return url.href; }));

function canvasFallbackWorkerMain() {
    let canvas = null;
    let context = null;
    let substrate = null;
    let substrateState = null;
    let features = [];
    let geometryRevision = 0;
    let projectGeneration = 0;
    let countrySharedBoundary = null;
    let terrainManifest = null;
    let terrainManifestUrl = '';
    let terrainManifestFailure = false;
    let terrainDemManifest = null;
    let terrainDemManifestUrl = '';
    let terrainTint = null;
    const demTiles = new Map();
    const demRequests = new Map();
    const demQueue = [];
    const demQueuedKeys = new Set();
    const demFailures = new Map();
    let demActiveFetches = 0;
    let demCacheBytes = 0;
    const demCacheLimit = 96 * 1024 * 1024;
    let demManifestLoading = false;
    let demManifestAttempts = 0;
    let terrainFrameStats = {};
    let wantedDemKeys = new Set();
    const terrainTiles = new Map();
    const terrainRequests = new Map();
    const terrainFetchQueue = [];
    const terrainQueuedKeys = new Set();
    const terrainFailures = new Map();
    const terrainProtectedKeys = new Set();
    let terrainActiveFetches = 0;
    let terrainFetchConcurrency = 2;
    const hydroPacks = new Map();
    let hydroPackRevision = 0;
    let hydroEditFeatures = [];
    let hydroEditRevision = -1;
    let hydroActivePackIds = new Set();
    let hydroPort = null;
    let lastRenderMessage = null;
    let viewRevision = 0;
    let styleRevision = 0;
    let physicalStyleRevision = 0;
    let hydroRenderTimer = 0;
    const boundaryOutlineCache = new WeakMap();
    const hydroSegments = new WeakMap();
    const hydroProfileWidths = new WeakMap();
    let projectedPathKey = '';
    let projectedPaths = new WeakMap();

    function createCanvasPath(projection, target) {
      // Presentation-only cache of exact D3 output. Keep only the current view;
      // geometry replacement/revisions and project changes cannot reuse old paths.
      const key = JSON.stringify([projectGeneration, geometryRevision, projection.scale(), projection.translate(),
        projection.rotate(), projection.center(), projection.clipAngle(), projection.clipExtent(), projection.precision()]);
      if (key !== projectedPathKey) { projectedPathKey = key; projectedPaths = new WeakMap(); }
      const cache = projectedPaths;
      let recording;
      const recorder = {
        moveTo: (x, y) => recording.push(0, x, y),
        lineTo: (x, y) => recording.push(1, x, y),
        closePath: () => recording.push(2),
        arc: (x, y, radius, start, end, reverse = false) => recording.push(3, x, y, radius, start, end, Number(reverse)),
      };
      const compiler = self.d3.geo.path().projection(projection).context(recorder);
      const path = geometry => {
        const shape = geometry.type === 'Feature' ? geometry.geometry : geometry;
        if (!shape) return;
        let commands = cache.get(shape);
        if (!commands) {
          recording = [];
          compiler(shape);
          commands = Float64Array.from(recording);
          recording = null;
          cache.set(shape, commands);
        }
        for (let index = 0; index < commands.length;) {
          const operation = commands[index++];
          if (operation === 0) { target.moveTo(commands[index], commands[index + 1]); index += 2; }
          else if (operation === 1) { target.lineTo(commands[index], commands[index + 1]); index += 2; }
          else if (operation === 2) target.closePath();
          else { target.arc(...commands.subarray(index, index + 6)); index += 6; }
        }
      };
      path.context = function(value) { if (!arguments.length) return target; target = value; return path; };
      return path;
    }

    function mergeRenderState(message) {
      const updated = { ...message };
      for (const channel of ['scenePolygons', 'interactionPolygons', 'sceneStrokes']) {
        if (!Array.isArray(message[channel])) continue;
        const previous = new Map((lastRenderMessage?.[channel] || []).map(packet => [packet.key, packet]));
        updated[channel] = message[channel].map(packet => packet.ringCoordinates || packet.startsEnds ? packet : { ...previous.get(packet.key), ...packet });
      }
      lastRenderMessage = { ...(lastRenderMessage || {}), ...updated, type: 'render' };
      return lastRenderMessage;
    }

    function terrainTileSpec(level, column, row) {
      const x0 = column * level.tileSize;
      const y0 = row * level.tileSize;
      const x1 = Math.min(level.width, x0 + level.tileSize);
      const y1 = Math.min(level.height, y0 + level.tileSize);
      return {
        key: `${level.id}/${column}-${row}`,
        level: Number(level.id),
        column,
        row,
        pixelWidth: x1 - x0,
        pixelHeight: y1 - y0,
        bounds: [
          -180 + x0 / level.width * 360,
          90 - y0 / level.height * 180,
          -180 + x1 / level.width * 360,
          90 - y1 / level.height * 180,
        ],
      };
    }

    function terrainNeighbourSpecs(level, specs) {
      const output = [];
      const seen = new Set(specs.map(spec => spec.key));
      for (const spec of specs) {
        for (let row = Math.max(0, spec.row - 1); row <= Math.min(level.rows - 1, spec.row + 1); row += 1) {
          for (let column = Math.max(0, spec.column - 1); column <= Math.min(level.columns - 1, spec.column + 1); column += 1) {
            const neighbour = terrainTileSpec(level, column, row);
            if (seen.has(neighbour.key)) continue;
            seen.add(neighbour.key);
            output.push(neighbour);
          }
        }
      }
      return output;
    }

    function terrainTileUrl(spec, manifest = terrainManifest, manifestUrl = terrainManifestUrl) {
      const relative = manifest.urlTemplate
        .replace('{level}', String(spec.level))
        .replace('{column}', String(spec.column))
        .replace('{row}', String(spec.row));
      return new URL(relative, new URL('../../', manifestUrl)).href;
    }

    async function prepareTerrainBitmap(blob) {
      let bitmap;
      try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
      catch (_) { bitmap = await createImageBitmap(blob); }
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const sourceContext = source.getContext('2d', { willReadFrequently: true });
      sourceContext.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const pixels = sourceContext.getImageData(0, 0, source.width, source.height);
      const physicalPixels = new Uint8ClampedArray(pixels.data.length);
      const politicalPixels = new Uint8ClampedArray(pixels.data.length);
      for (let offset = 0; offset < pixels.data.length; offset += 4) {
        const neutral = pixels.data[offset + 3];
        physicalPixels[offset] = pixels.data[offset];
        physicalPixels[offset + 1] = pixels.data[offset + 1];
        physicalPixels[offset + 2] = pixels.data[offset + 2];
        physicalPixels[offset + 3] = 255;
        politicalPixels[offset] = neutral;
        politicalPixels[offset + 1] = neutral;
        politicalPixels[offset + 2] = neutral;
        politicalPixels[offset + 3] = 255;
      }
      const physical = new OffscreenCanvas(source.width, source.height);
      const political = new OffscreenCanvas(source.width, source.height);
      physical.getContext('2d').putImageData(new ImageData(physicalPixels, source.width, source.height), 0, 0);
      political.getContext('2d').putImageData(new ImageData(politicalPixels, source.width, source.height), 0, 0);
      return { physical, political };
    }

    async function readRgba(blob) {
      let bitmap;
      try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
      catch (_) { bitmap = await createImageBitmap(blob); }
      const source = new OffscreenCanvas(bitmap.width, bitmap.height);
      const read = source.getContext('2d', { willReadFrequently: true });
      read.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      return read.getImageData(0, 0, source.width, source.height);
    }

    async function prepareDemBitmap(blob, spec) {
      const pixels = await readRgba(blob);
      if (!terrainTint || pixels.width !== spec.pixelWidth + 2 || pixels.height !== spec.pixelHeight + 2)
        throw new Error(`DEM 타일 크기 또는 tint가 올바르지 않습니다: ${spec.key}`);
      const level = terrainDemManifest.levels[spec.level];
      const converted = self.PandoLabCanvasTerrainDem.convertTile({ dem: pixels.data, width: pixels.width, height: pixels.height,
        tint: terrainTint.data, tintWidth: terrainTint.width, tintHeight: terrainTint.height,
        bounds: spec.bounds, pixelWidth: spec.pixelWidth, pixelHeight: spec.pixelHeight,
        levelWidth: level.width, levelHeight: level.height });
      const layers = [converted.land, converted.ocean, converted.political];
      const result = layers.map(data => {
        const canvas = new OffscreenCanvas(pixels.width, pixels.height);
        canvas.getContext('2d').putImageData(new ImageData(data, pixels.width, pixels.height), 0, 0);
        return canvas;
      });
      return { land: result[0], ocean: result[1], political: result[2], bytes: pixels.width * pixels.height * 12 };
    }

    function requestDemTile(spec, priority = 0) {
      if (!terrainDemManifest || !terrainTint || !wantedDemKeys.has(spec.key) || demTiles.has(spec.key) || demRequests.has(spec.key) || demQueuedKeys.has(spec.key)) return;
      const previous = demFailures.get(spec.key);
      if (previous?.retryAt > performance.now()) return;
      demQueuedKeys.add(spec.key);
      demQueue.push({ spec, priority });
      demQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
      pumpDemQueue();
    }

    function pumpDemQueue() {
      while (demActiveFetches < 2 && demQueue.length) {
        const { spec, priority } = demQueue.shift();
        demQueuedKeys.delete(spec.key);
        demActiveFetches += 1;
        const previous = demFailures.get(spec.key);
        const controller = new AbortController();
        const request = fetch(terrainTileUrl(spec, terrainDemManifest, terrainDemManifestUrl), { signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error(`DEM 타일 HTTP ${response.status}`); return response.blob(); })
          .then(blob => prepareDemBitmap(blob, spec))
          .then(tile => {
            if (controller.signal.aborted) return;
            demFailures.delete(spec.key);
            demTiles.set(spec.key, { ...tile, lastUsed: performance.now() });
            demCacheBytes += tile.bytes;
            while (demCacheBytes > demCacheLimit) {
              const oldest = [...demTiles.entries()].filter(([key]) => key !== spec.key && !terrainProtectedKeys.has(`dem:${key}`))
                .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
              if (!oldest) break;
              demCacheBytes -= oldest[1].bytes;
              demTiles.delete(oldest[0]);
            }
            self.postMessage({ type: 'terrain-ready', count: demTiles.size, key: `dem:${spec.key}` });
          })
          .catch(error => {
            if (controller.signal.aborted || error?.name === 'AbortError') return;
            const attempts = Number(previous?.attempts || 0) + 1;
            const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
            demFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay });
            if (attempts <= 3) setTimeout(() => requestDemTile(spec, priority), retryDelay);
            self.postMessage({ type: 'terrain-warning', message: error?.message || String(error) });
          })
          .finally(() => {
            demRequests.delete(spec.key);
            demActiveFetches = Math.max(0, demActiveFetches - 1);
            pumpDemQueue();
          });
        demRequests.set(spec.key, { request, controller });
      }
    }

    async function loadDemManifest(url) {
      if (!url || terrainDemManifest || demManifestLoading) return;
      demManifestLoading = true;
      terrainDemManifestUrl = url;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`DEM 매니페스트 HTTP ${response.status}`);
        const validationUrl = new URL('../modules/terrain-manifest.js', self.location.href);
        validationUrl.searchParams.set('v', assetRevision);
        const { validateTerrainManifest } = await import(validationUrl.href);
        const manifest = validateTerrainManifest(await response.json());
        if (manifest.representation !== 'dem-relief-v1' || !manifest.tint?.url || manifest.levels?.length !== 6)
          return;
        const tintUrl = new URL(manifest.tint.url, new URL('../../', url));
        const tintResponse = await fetch(tintUrl);
        if (!tintResponse.ok) throw new Error(`DEM tint HTTP ${tintResponse.status}`);
        const tint = await readRgba(await tintResponse.blob());
        if (tint.width !== manifest.tint.width || tint.height !== manifest.tint.height) throw new Error('DEM tint 크기가 올바르지 않습니다.');
        terrainTint = tint;
        terrainDemManifest = manifest;
        self.postMessage({ type: 'terrain-ready', count: 0, key: 'dem-manifest' });
      } catch (error) {
        demManifestAttempts += 1;
        if (demManifestAttempts <= 3) setTimeout(() => loadDemManifest(url), Math.min(4000, 400 * 2 ** (demManifestAttempts - 1)));
        self.postMessage({ type: 'terrain-warning', message: error?.message || String(error) });
      } finally { demManifestLoading = false; }
    }

    function requestTerrainTile(spec, priority = 0, pump = true) {
      if (!terrainManifest || terrainTiles.has(spec.key) || terrainRequests.has(spec.key) || terrainQueuedKeys.has(spec.key)) return;
      const previousFailure = terrainFailures.get(spec.key);
      if (previousFailure?.retryAt > performance.now()) return;
      terrainQueuedKeys.add(spec.key);
      terrainFetchQueue.push({ spec, priority: Number(priority || 0) });
      terrainFetchQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
      if (pump) pumpTerrainFetchQueue();
    }

    function pumpTerrainFetchQueue() {
      while (terrainActiveFetches < terrainFetchConcurrency && terrainFetchQueue.length) {
        const next = terrainFetchQueue.shift();
        terrainQueuedKeys.delete(next.spec.key);
        startTerrainTileRequest(next.spec, next.priority);
      }
    }

    function startTerrainTileRequest(spec, priority) {
      const previousFailure = terrainFailures.get(spec.key);
      const controller = new AbortController();
      terrainActiveFetches += 1;
      const request = fetch(terrainTileUrl(spec), { signal: controller.signal })
        .then(response => {
          if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
          return response.blob();
        })
        .then(prepareTerrainBitmap)
        .then(images => {
          if (controller.signal.aborted) { images.physical?.close?.(); images.political?.close?.(); return; }
          terrainFailures.delete(spec.key);
          terrainTiles.set(spec.key, { ...images, lastUsed: performance.now() });
          while (terrainTiles.size > 40) {
            const oldest = [...terrainTiles.entries()]
              .filter(([key]) => !terrainProtectedKeys.has(key))
              .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
            if (!oldest || oldest[0] === spec.key) break;
            terrainTiles.delete(oldest[0]);
          }
          self.postMessage({ type: 'terrain-ready', count: terrainTiles.size, key: spec.key });
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          const attempts = Number(previousFailure?.attempts || 0) + 1;
          const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
          terrainFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay });
          if (attempts <= 3) setTimeout(() => requestTerrainTile(spec, priority), retryDelay);
          self.postMessage({ type: 'terrain-warning', message: error?.message || String(error) });
        })
        .finally(() => {
          if (terrainRequests.get(spec.key)?.promise === request) terrainRequests.delete(spec.key);
          terrainActiveFetches = Math.max(0, terrainActiveFetches - 1);
          if (controller.signal.aborted && terrainProtectedKeys.has(spec.key)) requestTerrainTile(spec, priority, false);
          pumpTerrainFetchQueue();
        });
      terrainRequests.set(spec.key, { promise: request, controller });
    }

    async function loadTerrainManifest(url) {
      if (!url || terrainManifest || terrainManifestUrl === url) return;
      terrainManifestUrl = url;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`지형 매니페스트 HTTP ${response.status}`);
        terrainManifest = await response.json();
        const base = terrainManifest.levels?.[0];
        if (!base) throw new Error('지형 타일 단계가 없습니다.');
        self.postMessage({ type: 'terrain-ready', count: 0, key: 'manifest' });
      } catch (error) {
        terrainManifestFailure = true;
        self.postMessage({ type: 'terrain-warning', message: error?.message || String(error) });
      }
    }

    function terrainLevelForView(projection, terrainDpr, manifest = terrainManifest) {
      if (!manifest?.levels?.length) return null;
      const desiredWidth = Math.max(1, 2 * Math.PI * projection.scale() * Math.max(1, Number(terrainDpr || 1)));
      return manifest.levels.find(level => level.width >= desiredWidth * 1.12)
        || manifest.levels[manifest.levels.length - 1];
    }

    function visibleTerrainTileSpecs(level, message, projection, width, height, includeAll = false) {
      const specs = [];
      const view = message.view || {};
      const scale = projection.scale();
      const center = message.projection === 'globe'
        ? [-Number(view.globeRotation?.[0] || 0), -Number(view.globeRotation?.[1] || 0)]
        : (view.flatCenter || [0, 20]);
      const flatHalfLon = width / Math.max(1, scale) * 90 / Math.PI;
      const flatHalfLat = height / Math.max(1, scale) * 90 / Math.PI;
      const globeRadius = Math.asin(Math.min(1, Math.hypot(width, height) * 0.5 / Math.max(1, scale)));
      for (let row = 0; row < level.rows; row += 1) {
        for (let column = 0; column < level.columns; column += 1) {
          const spec = terrainTileSpec(level, column, row);
          if (includeAll) {
            specs.push(spec);
            continue;
          }
          const [west, north, east, south] = spec.bounds;
          const tileCenter = [(west + east) / 2, (north + south) / 2];
          const halfLon = (east - west) / 2;
          const halfLat = (north - south) / 2;
          if (message.projection === 'flat') {
            const deltaLon = Math.abs((((tileCenter[0] - center[0]) + 540) % 360) - 180);
            if (deltaLon <= flatHalfLon + halfLon + 2 && Math.abs(tileCenter[1] - center[1]) <= flatHalfLat + halfLat + 2) specs.push(spec);
          } else if (self.d3.geo.distance(center, tileCenter) <= globeRadius + Math.hypot(halfLon, halfLat) * Math.PI / 180 + 0.04) {
            specs.push(spec);
          }
        }
      }
      return specs;
    }

    function drawTexturedTriangle(image, sourcePoints, destinationPoints, dpr) {
      if (destinationPoints.some(point => !point || !point.every(Number.isFinite))) return;
      // Globe tiles cover much more than the viewport at high zoom. Reject
      // invisible image copies before building a clip or changing transforms.
      // Keep the same physical-pixel overlap as triangleClip at viewport edges.
      const padding = 0.75 / dpr, width = canvas.width / dpr, height = canvas.height / dpr;
      if (destinationPoints.every(point => point[0] < -padding)
        || destinationPoints.every(point => point[0] > width + padding)
        || destinationPoints.every(point => point[1] < -padding)
        || destinationPoints.every(point => point[1] > height + padding)) return;
      const transform = self.PandoLabCanvasTerrainDem.affineTransform(sourcePoints, destinationPoints);
      if (!transform) return;
      context.save();
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const clip = self.PandoLabCanvasTerrainDem.triangleClip(destinationPoints, 0.75 / dpr);
      context.beginPath();
      context.moveTo(...clip[0]);
      context.lineTo(...clip[1]);
      context.lineTo(...clip[2]);
      context.closePath();
      context.clip();
      context.setTransform(dpr * transform[0], dpr * transform[1], dpr * transform[2], dpr * transform[3], dpr * transform[4], dpr * transform[5]);
      context.drawImage(image, 0, 0);
      context.restore();
    }

    function drawFlatTerrainTile(spec, image, projection, dpr) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      const gutter = Number(terrainManifest.gutter || 0);
      const [west, north, east, south] = spec.bounds;
      for (const offset of [-360, 0, 360]) {
        // D3 wraps point longitudes; applying it to a tile's opposite corners
        // can mirror a whole tile when the camera crosses the antimeridian.
        const rectangle = self.PandoLabCanvasTerrainDem.flatTileRectangle([west, north, east, south],
          projection.scale(), projection.translate(), projection.center(), offset);
        context.drawImage(
          image,
          gutter,
          gutter,
          spec.pixelWidth,
          spec.pixelHeight,
          ...rectangle.map(value => value * dpr),
        );
      }
    }

    function drawGlobeTerrainTile(spec, image, projection, message, dpr, isBase) {
      const gutter = Number(terrainManifest.gutter || 0);
      const [west, north, east, south] = spec.bounds;
      const zoom = Math.max(1, Number(message.view?.globeZoom || 1));
      const step = isBase ? 4 : Math.max(0.24, Math.min(4, 4 / zoom));
      const stepsX = Math.max(1, Math.ceil((east - west) / step));
      const stepsY = Math.max(1, Math.ceil((north - south) / step));
      const center = [-Number(message.view?.globeRotation?.[0] || 0), -Number(message.view?.globeRotation?.[1] || 0)];
      const front = coordinate => self.d3.geo.distance(center, coordinate) <= Math.PI / 2 + 0.012;
      for (let y = 0; y < stepsY; y += 1) {
        const v0 = y / stepsY;
        const v1 = (y + 1) / stepsY;
        const lat0 = north + (south - north) * v0;
        const lat1 = north + (south - north) * v1;
        for (let x = 0; x < stepsX; x += 1) {
          const u0 = x / stepsX;
          const u1 = (x + 1) / stepsX;
          const lon0 = west + (east - west) * u0;
          const lon1 = west + (east - west) * u1;
          const coordinates = [[lon0, lat0], [lon1, lat0], [lon0, lat1], [lon1, lat1]];
          const visible = coordinates.map(front);
          if (!visible.some(Boolean)) continue;
          const destination = coordinates.map(projection);
          const source = [
            [gutter + u0 * spec.pixelWidth, gutter + v0 * spec.pixelHeight],
            [gutter + u1 * spec.pixelWidth, gutter + v0 * spec.pixelHeight],
            [gutter + u0 * spec.pixelWidth, gutter + v1 * spec.pixelHeight],
            [gutter + u1 * spec.pixelWidth, gutter + v1 * spec.pixelHeight],
          ];
          if (visible[0] && visible[1] && visible[2]) drawTexturedTriangle(image, [source[0], source[1], source[2]], [destination[0], destination[1], destination[2]], dpr);
          if (visible[1] && visible[3] && visible[2]) drawTexturedTriangle(image, [source[1], source[3], source[2]], [destination[1], destination[3], destination[2]], dpr);
        }
      }
    }

    function terrainRenderPlan(message, projection, width, height, dpr) {
      if (!message.physicalSettings?.terrainVisible || !terrainManifest?.levels?.length) return null;
      const levels = terrainManifest.levels;
      // Source detail follows the physical view scale and original DPR,
      // independently of the preview/canonical country mesh quality.
      const targetLevel = terrainLevelForView(projection, message.terrainDpr || dpr);
      const targetSpecs = visibleTerrainTileSpecs(targetLevel, message, projection, width, height, false);
      const neighbours = terrainNeighbourSpecs(targetLevel, targetSpecs);
      const baseLevel = levels[0];
      const baseSpecs = visibleTerrainTileSpecs(baseLevel, message, projection, width, height, true);
      const baseReady = baseSpecs.every(spec => terrainTiles.has(spec.key));
      const terrainComplete = targetSpecs.every(spec => terrainTiles.has(spec.key));
      const missingSpecs = targetSpecs.filter(spec => !terrainTiles.has(spec.key));
      const fallbackSpecs = missingSpecs.length && message.terrainAllowFallback
        ? levels.filter(level => level.id !== targetLevel.id && level.id !== baseLevel.id)
          .flatMap(level => visibleTerrainTileSpecs(level, message, projection, width, height))
          .filter(spec => terrainTiles.has(spec.key) && missingSpecs.some(target =>
            spec.bounds[0] < target.bounds[2] && spec.bounds[2] > target.bounds[0]
            && spec.bounds[3] < target.bounds[1] && spec.bounds[1] > target.bounds[3]))
          .sort((a, b) => a.level - b.level)
        : [];
      // Canvas country geometry quality does not own DEM source resolution.
      let demLevel = terrainDemManifest
        ? terrainLevelForView(projection, message.terrainDpr || dpr, terrainDemManifest) : null;
      let demSpecs = demLevel ? visibleTerrainTileSpecs(demLevel, message, projection, width, height, false) : [];
      // Cache pressure may evict unretained tiles, never lower camera source resolution.
      const demNeighbours = demLevel ? terrainNeighbourSpecs(demLevel, demSpecs) : [];
      const demComplete = (!terrainDemManifestUrl || !!terrainDemManifest && !!terrainTint) && demSpecs.every(spec => demTiles.has(spec.key));
      const hold = (!message.terrainAllowFallback || message.backgroundPending) && (!terrainComplete || !demComplete);
      const drawSpecs = hold ? [] : [...(message.terrainAllowFallback && baseReady ? baseSpecs : []), ...fallbackSpecs, ...targetSpecs];
      const sourceLevel = demLevel || targetLevel;
      const desiredWidth = 2 * Math.PI * projection.scale() * Math.max(1, Number(message.terrainDpr || dpr)) * 1.12;
      return { targetLevel, targetSpecs, baseLevel, baseSpecs, terrainComplete, neighbours, fallbackSpecs, demLevel, demSpecs, demNeighbours, drawSpecs, hold,
        resolutionLimited: sourceLevel.width < desiredWidth };
    }

    function renderTerrain(message, projection, width, height, dpr, visibleLand, plan) {
      if (!plan) return true;
      const { targetSpecs, baseLevel, baseSpecs, terrainComplete, neighbours, fallbackSpecs, demLevel, demSpecs, demNeighbours, drawSpecs } = plan;
      terrainProtectedKeys.clear();
      for (const spec of [...baseSpecs, ...targetSpecs, ...neighbours, ...fallbackSpecs]) terrainProtectedKeys.add(spec.key);
      for (const spec of demSpecs) terrainProtectedKeys.add(`dem:${spec.key}`);
      const wantedDem = new Set([...demSpecs, ...demNeighbours].map(spec => spec.key));
      wantedDemKeys = wantedDem;
      for (const [key, request] of demRequests) if (!wantedDem.has(key)) request.controller.abort();
      for (let index = terrainFetchQueue.length - 1; index >= 0; index -= 1) {
        const key = terrainFetchQueue[index].spec.key;
        if (terrainProtectedKeys.has(key)) continue;
        terrainQueuedKeys.delete(key);
        terrainFetchQueue.splice(index, 1);
      }
      // Fill one priority batch before opening network slots.
      const visibleKeys = new Set(targetSpecs.map(spec => spec.key));
      for (const [key, request] of terrainRequests) if (!visibleKeys.has(key) && !terrainComplete) request.controller.abort();
      for (const spec of targetSpecs) requestTerrainTile(spec, 30_000, false);
      for (const spec of baseSpecs) requestTerrainTile(spec, 5_000, false);
      if (terrainComplete) for (const spec of neighbours) requestTerrainTile(spec, 120, false);
      pumpTerrainFetchQueue();
      for (let index = demQueue.length - 1; index >= 0; index -= 1) {
        if (wantedDem.has(demQueue[index].spec.key)) continue;
        demQueuedKeys.delete(demQueue[index].spec.key);
        demQueue.splice(index, 1);
      }
      for (const spec of demSpecs) requestDemTile(spec, 10_000);
      for (const spec of demNeighbours) requestDemTile(spec, 120);
      if (plan.hold) return false;
      const style = message.physicalSettings.terrainStyle === 'physical' ? 'physical' : 'political';
      context.save();
      context.globalAlpha = 1;
      context.filter = message.darkTheme ? 'brightness(0.84)' : 'none';
      if (style === 'political') {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.beginPath();
        // Use the same adopted country geometry as the Canvas substrate
        // and country fills, including country visibility and edit patches.
        const landPath = createCanvasPath(projection, context);
        for (const geometry of self.PandoLabCanvasSceneComposition.generalLandShapes(message.scenePolygons || [])) landPath(geometry);
        context.clip();
      }
      if (message.projection === 'globe') {
        const center = projection.translate();
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.beginPath();
        context.arc(center[0], center[1], projection.scale(), 0, Math.PI * 2);
        context.clip();
        context.setTransform(1, 0, 0, 1, 0, 0);
      }
      for (const spec of drawSpecs) {
        const tile = terrainTiles.get(spec.key);
        if (!tile) continue;
        tile.lastUsed = performance.now();
        const image = tile[style];
        if (message.projection === 'flat') drawFlatTerrainTile(spec, image, projection, dpr);
        else drawGlobeTerrainTile(spec, image, projection, message, dpr, spec.level === baseLevel.id);
      }
      if (demLevel) {
        const drawDem = channel => {
          for (const spec of demSpecs) {
            const tile = demTiles.get(spec.key);
            if (!tile) continue; // The preview remains visible until this detailed tile is ready.
            tile.lastUsed = performance.now();
            if (message.projection === 'flat') drawFlatTerrainTile(spec, tile[channel], projection, dpr);
            else drawGlobeTerrainTile(spec, tile[channel], projection, message, dpr, demLevel.id === 0);
          }
        };
        if (style === 'political') drawDem('political');
        else {
          drawDem('ocean');
          context.save();
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          context.beginPath();
          const landPath = createCanvasPath(projection, context);
          for (const geometry of self.PandoLabCanvasSceneComposition.generalLandShapes(message.scenePolygons || [])) landPath(geometry);
          context.clip();
          drawDem('land');
          context.restore();
        }
      }
      context.restore();
      return terrainComplete && demSpecs.every(spec => demTiles.has(spec.key));
    }

    function updateTerrainFrameStats(plan) {
      if (!plan) { terrainFrameStats = { terrainReady: false, terrainFailed: terrainManifestFailure }; return; }
      const { demSpecs, demLevel, targetLevel, targetSpecs, terrainComplete } = plan;
      const exhausted = (specs, tiles, failures) => specs.some(spec => !tiles.has(spec.key) && Number(failures.get(spec.key)?.attempts || 0) >= 4);
      terrainFrameStats = {
        terrainReady: terrainComplete && (!terrainDemManifestUrl || !!terrainDemManifest && !!terrainTint)
          && demSpecs.every(spec => demTiles.has(spec.key)),
        terrainFailed: demManifestAttempts >= 4 || exhausted(targetSpecs, terrainTiles, terrainFailures) || exhausted(demSpecs, demTiles, demFailures),
        terrainResolutionLimited: plan.resolutionLimited,
        terrainTargetKey: `${projectGeneration}:${terrainManifest.version}:${terrainDemManifest?.version || ''}:${targetSpecs.map(spec => spec.key).sort().join(',')}:dem:${demSpecs.map(spec => spec.key).sort().join(',')}`,
        terrainRepresentation: demSpecs.some(spec => demTiles.has(spec.key)) ? 'dem-relief-v1' : 'raster-rgba-v1',
        terrainDatasetVersion: demSpecs.some(spec => demTiles.has(spec.key)) ? terrainDemManifest.version : terrainManifest.version,
        terrainSource: demSpecs.some(spec => demTiles.has(spec.key)) ? 'dem-derived-canvas' : 'dem-preview',
        terrainTargetLevel: demLevel?.id ?? targetLevel.id,
        terrainDetailTileCount: demSpecs.filter(spec => demTiles.has(spec.key)).length,
        terrainCacheBytes: demCacheBytes + [...terrainTiles.values()].reduce((sum, tile) => sum + tile.physical.width * tile.physical.height * 8, 0),
        terrainDemCacheBytes: demCacheBytes,
      };
    }

    function canvasPathPadding(message) {
      // D3 clips centerlines before Canvas applies stroke/point coverage.
      let radius = 4.5; // D3 geo.path's point radius.
      for (const style of [...Object.values(message.theme?.strokes || {}), ...(message.sceneStrokes || []).map(packet => packet.style)]) {
        const extension = style.join === 'miter' ? 10 : style.cap === 'square' ? Math.SQRT2 : 1;
        radius = Math.max(radius, Number(style.width || 0) * extension / 2);
      }
      for (const feature of activeHydroFeatures()) {
        const profiles = feature.properties?.stroke_widths;
        let width = Math.max(0.55, Math.min(2.6, Number(feature.properties?.stroke_width || 0.8)));
        if (profiles) {
          let maximum = hydroProfileWidths.get(profiles);
          if (maximum === undefined) {
            maximum = 0;
            for (const part of profiles) for (const value of part) maximum = Math.max(maximum, Number(value) || 0);
            hydroProfileWidths.set(profiles, maximum);
          }
          width = Math.max(width, maximum);
        }
        radius = Math.max(radius, width * Number(message.theme?.strokes?.river?.width || 1) / 2);
      }
      return Math.ceil(radius + 1 / Math.max(1, Number(message.dpr || 1)));
    }

    function createProjection(message, width, height) {
      const view = message.view || {};
      const frame = message.renderProjection || {};
      const translate = frame.translate || [width / 2, height / 2];
      if (message.projection === 'globe') {
        const fallback = Math.max(60, Math.min(width, height - 26) * 0.455) * Number(view.globeZoom || 1);
        const padding = canvasPathPadding(message);
        return self.d3.geo.orthographic().translate(translate).scale(frame.scale || fallback)
          .rotate(view.globeRotation || [-15, -25, 0]).clipAngle(90)
          // Clip projected paths before Canvas rasterizes the enlarged globe.
          // A context clip alone still submits its offscreen land and masks.
          .clipExtent([[-padding, -padding], [width + padding, height + padding]]).precision(0.35);
      }
      const safe = frame.safeInset || { left: 0, top: 0, right: 0, bottom: 0 };
      return self.d3.geo.equirectangular().translate(translate)
        .scale(frame.scale || Math.max(30, width / (2 * Math.PI)) * Number(view.flatZoom || 1))
        .center(view.flatCenter || [0, 20]).rotate([0, 0, 0])
        .clipExtent([[safe.left, safe.top], [width - safe.right, height - safe.bottom]]).precision(0.25);
    }

    function activeHydroFeatures(includeEdits = true) {
      const result = [];
      for (const packId of hydroActivePackIds) result.push(...(hydroPacks.get(Number(packId)) || []));
      if (includeEdits) result.push(...hydroEditFeatures);
      return result;
    }

    function hydroFeatureVisible(feature, message) {
      const properties = feature.properties || {};
      if (properties.category === 'lake' ? !message.lakesVisible : !message.riversVisible) return false;
      if (message.physicalSettings?.hydroLayers?.[properties.layer_id] === false) return false;
      if(message.hydroVisibility?.[String(properties.pandolab_id || feature.id)]===false)return false;
      return true;
    }

    function lineParts(geometry) {
      if (geometry?.type === 'LineString') return [geometry.coordinates || []];
      if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
      return [];
    }

    function automaticWaterColor(message) {
      if (!(message.physicalSettings?.terrainVisible && message.physicalSettings?.terrainStyle === 'physical')) {
        return message.theme?.ocean || '#0d2837';
      }
      const source = String(terrainManifest?.displayColors?.oceanRepresentative || '#6aa8d2');
      const match = /^#([0-9a-f]{6})$/i.exec(source);
      if (!match || !message.darkTheme) return match ? source : '#6aa8d2';
      const packed = Number.parseInt(match[1], 16);
      const values = [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
        .map((value, index) => Math.max(0, Math.min(255, Math.round(value * [0.808, 0.8464, 0.8848][index]))));
      return `#${values.map(value => value.toString(16).padStart(2, '0')).join('')}`;
    }

    function renderHydroPass(message, projection, dpr, role, target = context, reserve = false) {
      const context = target;
      const geoPath = createCanvasPath(projection, context);
      const features = activeHydroFeatures();
      context.save();
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      const waterColor = automaticWaterColor(message);
      for (const feature of features) {
        if (!hydroFeatureVisible(feature, message)) continue;
        const properties = feature.properties || {};
        const isLake = properties.category === 'lake';
        const featureColor = properties.editorColor || waterColor;
        const hydroOpacity = Number.isFinite(Number(isLake ? message.theme?.lakeOpacity : message.theme?.riverOpacity))
          ? Math.max(0, Math.min(1, Number(isLake ? message.theme?.lakeOpacity : message.theme?.riverOpacity)))
          : 1;
        if (hydroOpacity <= 0) continue;
        const isBorder = properties.border_aligned === true || (Number(properties.__flags || 0) & 1) !== 0;
        if (isLake) {
          if (!['lake', 'lake-boundary'].includes(role)) continue;
          context.beginPath();
          geoPath(feature);
          context.globalAlpha = reserve ? 1 : hydroOpacity;
          context.fillStyle = featureColor;
          if (role === 'lake') context.fill();
          if (role === 'lake-boundary' && message.theme?.lakeBoundaryVisible !== false) {
            const outline = boundaryOutlineFeature(feature);
            if (outline.geometry.coordinates.length) {
              context.beginPath();
              geoPath(outline);
              context.lineWidth = message.theme.strokes['hydro-boundary'].width;
              context.strokeStyle = featureColor;
              context.stroke();
            }
          }
          continue;
        }
        if (role !== (isBorder ? 'border-river' : 'river')) continue;
        const parts = lineParts(feature.geometry);
        const profiles = properties.stroke_widths || [];
        const fallback = Math.max(0.55, Math.min(2.6, Number(properties.stroke_width || 0.8)));
        context.globalAlpha = reserve ? 1 : hydroOpacity;
        context.strokeStyle = featureColor;
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          let segments = hydroSegments.get(part);
          if (!segments) {
            segments = part.slice(1).map((end, index) => ({ type: 'LineString', coordinates: [part[index], end] }));
            hydroSegments.set(part, segments);
          }
          const widths = profiles[partIndex] || [];
          for (let index = 0; index < part.length - 1; index += 1) {
            context.beginPath();
            geoPath(segments[index]);
            const start = Number(widths[index] ?? fallback);
            const end = Number(widths[index + 1] ?? start);
            context.lineWidth = (start + end) / 2 * message.theme.strokes.river.width;
            context.stroke();
          }
        }
      }
      context.restore();
    }

    function pickHydroFeature(point) {
      const message = lastRenderMessage;
      if (!message || !Array.isArray(point)) return null;
      const width = Math.max(1, Number(message.width || 1));
      const height = Math.max(1, Number(message.height || 1));
      const projection = createProjection(message, width, height);
      const coordinate = projection.invert(point);
      if (!coordinate) return null;
      let nearest = null;
      for (const feature of activeHydroFeatures(false)) {
        if (!hydroFeatureVisible(feature, message)) continue;
        const properties = feature.properties || {};
        if (properties.category === 'lake') {
          // Pick the exact projected path used by Canvas drawing, including
          // holes, the date-line clip, and the visible globe hemisphere.
          context.save();
          let hit;
          try {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.beginPath();
            self.d3.geo.path().projection(projection).context(context)(feature);
            hit = context.isPointInPath(point[0], point[1]);
          } finally { context.restore(); }
          if (hit) return Number(properties.__fid);
          continue;
        }
        for (const part of lineParts(feature.geometry)) {
          for (let index = 0; index < part.length - 1; index += 1) {
            const a = projection(part[index]);
            const b = projection(part[index + 1]);
            if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) > width * 0.7) continue;
            const vx = b[0] - a[0], vy = b[1] - a[1];
            const length2 = vx * vx + vy * vy;
            const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / length2)) : 0;
            const distance = Math.hypot(point[0] - (a[0] + vx * t), point[1] - (a[1] + vy * t));
            if (distance <= 7 && (!nearest || distance < nearest.distance)) nearest = { fid: Number(properties.__fid), distance };
          }
        }
      }
      return nearest?.fid ?? null;
    }

    function scheduleHydroRender() {
      if (!lastRenderMessage || hydroRenderTimer) return;
      hydroRenderTimer = setTimeout(() => {
        hydroRenderTimer = 0;
        try { render(lastRenderMessage); }
        catch (error) { self.postMessage({ type: 'error', message: error?.message || String(error) }); }
      }, 0);
    }

    function connectHydroPort(port) {
      hydroPort?.close?.();
      hydroPort = port || null;
      if (!hydroPort) return;
      hydroPort.onmessage = event => {
        const message = event.data || {};
        if (message.type === 'pack') {
          hydroPacks.set(Number(message.packId), message.features || []);
          hydroPackRevision++;
          if (hydroActivePackIds.has(Number(message.packId))) scheduleHydroRender();
        }
        else if (message.type === 'active') {
          hydroActivePackIds = new Set((message.packIds || []).map(Number));
          scheduleHydroRender();
        } else if (message.type === 'release') {
          for (const packId of message.packIds || []) hydroPacks.delete(Number(packId));
          hydroPackRevision++;
        }
      };
      hydroPort.start?.();
    }

    function countryId(feature, index) {
      return String(feature?.id || index);
    }

    function retainCountryGeometry(feature, previous) {
      return typeof feature.boundaryGeometryRevision === 'string'
        && feature.boundaryGeometryRevision === previous?.boundaryGeometryRevision
        ? { ...feature, geometry: previous.geometry } : feature;
    }

    function replaceCountryFeatures(incoming, generation) {
      const previous = Number(generation || projectGeneration) === projectGeneration
        ? new Map(features.map((feature, index) => [countryId(feature, index), feature])) : new Map();
      return incoming.map((feature, index) => retainCountryGeometry(feature, previous.get(countryId(feature, index))));
    }

    function boundaryOutlineFeature(feature) {
      const geometry = feature?.geometry;
      if (geometry && boundaryOutlineCache.has(geometry)) return boundaryOutlineCache.get(geometry);
      const lines = self.PandoLabGeographicBoundary.buildRenderableBoundarySegments(feature);
      const outline = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: feature?.properties || {} };
      if (geometry) boundaryOutlineCache.set(geometry, outline);
      return outline;
    }
    function renderCountryBoundaries(message, projection, dpr, target = context, reserve = false) {
      if (message.surfacePresentation.quality === 'pending' || countrySharedBoundary?.sourceQuality !== message.surfacePresentation.quality) return;
      const theme = message.theme, path = createCanvasPath(projection, target);
      const sharedOnly = message.physicalSettings?.terrainVisible && message.physicalSettings?.terrainStyle === 'physical';
      target.save(); target.setTransform(dpr, 0, 0, dpr, 0, 0);
      target.globalAlpha = reserve ? 1 : theme.borderAlpha;
      target.strokeStyle = theme.border;
      target.lineJoin = 'round'; target.lineWidth = theme.strokes.country.width;
      const batches = self.PandoLabCanvasSceneComposition.countryBoundaryBatches(countrySharedBoundary, theme, sharedOnly,
        id => message.countryBoundaryStyles[id]);
      self.PandoLabCanvasSceneComposition.drawStrokes(target, path,
        reserve ? batches.map(packet => ({ ...packet, style: { ...packet.style, alpha: 1 } })) : batches);
      target.restore();
    }
    function render(message, renderRequestId = null) {
      lastRenderMessage = message;
      const width = Math.max(1, Number(message.width || 1));
      const height = Math.max(1, Number(message.height || 1));
      const dpr = Math.max(1, Number(message.dpr || 1));
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      let terrainComplete;
      if (!canvas) {
        canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
        context = canvas.getContext('2d', { alpha: true });
      } else if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      if (!context) throw new Error('Canvas Worker 2D 컨텍스트를 만들 수 없습니다.');
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, pixelWidth, pixelHeight);
      {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const projection = createProjection(message, width, height);
        const theme = message.theme;
        const hiddenCountryIds = new Set((message.hiddenCountryIds || []).map(String));
        const geoPath = createCanvasPath(projection, context);
        const visibleLand = message.visible ? features.filter((feature, index) => !hiddenCountryIds.has(countryId(feature, index))) : [];
        const landShapes = self.PandoLabCanvasSceneComposition.generalLandShapes(message.scenePolygons || []);
        const terrainPlan = terrainRenderPlan(message, projection, width, height, dpr);
        const substrateKey = JSON.stringify([projectedPathKey, pixelWidth, pixelHeight, dpr, message.terrainDpr,
          message.physicalSettings?.terrainVisible, message.physicalSettings?.terrainStyle, message.darkTheme,
          theme.baseLandAlpha, theme.defaultLand, terrainManifest?.version, terrainDemManifest?.version,
          terrainPlan?.drawSpecs.filter(spec => terrainTiles.has(spec.key)).map(spec => spec.key),
          terrainPlan?.demSpecs.filter(spec => demTiles.has(spec.key)).map(spec => spec.key)]);
        const reuseSubstrate = substrate && substrateState?.key === substrateKey
          && landShapes.length === substrateState.shapes.length
          && landShapes.every((shape, index) => shape === substrateState.shapes[index]);
        if (reuseSubstrate) {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.drawImage(substrate, 0, 0);
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          context.lineJoin = 'round'; context.lineWidth = theme.strokes.country.width;
          terrainComplete = substrateState.complete;
        }
        const paint = {
          substrate: () => {
        context.globalAlpha = theme.baseLandAlpha;
        context.fillStyle = theme.defaultLand;
        self.PandoLabCanvasSceneComposition.drawGeneralLand(context, geoPath, message.scenePolygons || []);
        context.globalAlpha = 1;
          },
          terrain: () => {
        terrainComplete = renderTerrain(message, projection, width, height, dpr, visibleLand, terrainPlan);
        if (!substrate || substrate.width !== pixelWidth || substrate.height !== pixelHeight) substrate = new OffscreenCanvas(pixelWidth, pixelHeight);
        const substrateContext = substrate.getContext('2d');
        substrateContext.clearRect(0, 0, pixelWidth, pixelHeight);
        substrateContext.drawImage(canvas, 0, 0);
        substrateState = { key: substrateKey, shapes: landShapes, complete: terrainComplete };
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.lineJoin = 'round';
        context.lineWidth = theme.strokes.country.width;
          },
          'country-fill': () => {
        for (const feature of visibleLand) {
          const fill = message.fills[countryId(feature)];
          // Geometry patches and style messages can cross a background frame.
          if (!fill || !(fill.fillAlpha > 0)) continue;
          context.beginPath();
          geoPath(feature);
          context.globalAlpha = fill.fillAlpha;
          context.fillStyle = fill.color;
          context.fill();
        }
          },
          'territorial-fill': () => self.PandoLabCanvasSceneComposition.drawTerritorialFills(context, geoPath, message.scenePolygons || [], substrate, dpr, message.surfacePresentation),
          'country-boundary': () => renderCountryBoundaries(message, projection, dpr),
          'physical-water': () => self.PandoLabCanvasSceneComposition.drawPhysicalWater(context,geoPath,message.scenePolygons||[],{color:theme.ocean,fillAlpha:1}),
        };
        const protection = {
          key: [message.viewRevision, message.projectionRevision, pixelWidth, pixelHeight, physicalStyleRevision,
            hydroEditRevision, [...hydroActivePackIds].join(','), hydroPackRevision, geometryRevision,
            countrySharedBoundary?.geometryRevision, styleRevision].join(':'),
          draw: mask => {
            for (const role of message.visualOrder.hydro) renderHydroPass(message, projection, dpr, role, mask, true);
            self.PandoLabCanvasSceneComposition.drawPhysicalWater(mask,createCanvasPath(projection,mask),message.scenePolygons||[],{color:'#000000',fillAlpha:1});
            renderCountryBoundaries(message, projection, dpr, mask, true);
          },
        };
        paint['independent-overlay'] = () => {
        self.PandoLabCanvasSceneComposition.drawOverlays(context, geoPath, message.scenePolygons || [], message.sceneStrokes || [], dpr, protection);
        };
        for (const role of message.visualOrder.base) {
          if (reuseSubstrate && (role === 'substrate' || role === 'terrain')) continue;
          if (Object.hasOwn(paint, role)) paint[role]();
          else if (message.visualOrder.hydro.includes(role)) renderHydroPass(message, projection, dpr, role);
        }
        const emphasis = message.countryEmphasis || {};
        const selectedCountryIds = new Set((emphasis.selectedIds || []).map(String));
        const emphasisEntries = [];
        for (let index = 0; message.visible && index < features.length; index += 1) {
          const feature = features[index];
          const id = countryId(feature, index);
          if (hiddenCountryIds.has(id)) continue;
          const kind = (emphasis.primaryIds || [String(emphasis.primaryId || '')]).includes(id) ? 'primary'
            : selectedCountryIds.has(id) ? 'secondary' : id === String(emphasis.hoverId || '') ? 'hover' : '';
          if (kind) emphasisEntries.push({ key: `country:${id}`, geometry: feature,
            priority: emphasis.priorities?.[id] || (kind === 'primary' ? 4 : kind === 'secondary' ? 3 : 2),
            style: { color: emphasis[`${kind}Color`], fillAlpha: Number(emphasis[`${kind}Alpha`] || 0) } });
        }
        const polygonByKey = new Map((message.scenePolygons || []).map(packet => [packet.key, packet]));
        for (const item of message.interactionFillItems || []) if (polygonByKey.has(item.key)) emphasisEntries.push({ ...item, packet: polygonByKey.get(item.key) });
        for (const packet of message.interactionPolygons || []) emphasisEntries.push({ key: packet.key, packet,
          priority: packet.interactionPriority || 5, style: packet.style });
        self.PandoLabCanvasSceneComposition.drawEmphasis(context, geoPath, emphasisEntries, dpr, protection);
        context.globalAlpha = 1;
        updateTerrainFrameStats(terrainPlan);
      }
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({
        type: 'frame',
        presentationKey: message.presentationKey,
        styleRevision,
        // Background redraws reuse visual state, but never acknowledge a submission.
        renderRequestId,
        frameId: Number(message.frameId || message.revision || 0),
        revision: Number(message.revision || 0),
        viewRevision: Number(message.viewRevision || message.revision || 0),
        projectionRevision: Number(message.projectionRevision || 0),
        projectGeneration: Number(message.projectGeneration || 0),
        geometryRevision,
        bitmap,
        width: pixelWidth,
        height: pixelHeight,
        terrainComplete,
        terrainStats: terrainFrameStats,
      }, [bitmap]);
    }
    self.onmessage = event => {
      const message = event.data || {};
      if (message.projectGeneration != null && Number(message.projectGeneration) < projectGeneration) return;
      if (message.type === 'init') {
        features = replaceCountryFeatures(message.features || [], message.projectGeneration);
        geometryRevision = Number(message.geometryRevision || 0);
        projectGeneration = Number(message.projectGeneration || 0);
        countrySharedBoundary = message.sharedBoundary || null;
        viewRevision = Number(message.viewRevision || message.revision || 0);
        styleRevision = Number(message.styleRevision || 0);
        physicalStyleRevision = Number(message.physicalStyleRevision || 0);
        mergeRenderState(message);
        terrainFetchConcurrency = Math.max(1, Math.min(4, Number(message.terrainFetchConcurrency || 2)));
        if(message.terrainEnabled!==false){loadTerrainManifest(message.terrainManifestUrl);loadDemManifest(message.terrainDemManifestUrl);}
        self.postMessage({ type: 'ready' });
      } else if (message.type === 'retry-terrain') {
        terrainFailures.clear(); demFailures.clear();
        terrainManifestFailure = false; demManifestAttempts = 0;
        if (!terrainManifest) { const url = terrainManifestUrl; terrainManifestUrl = ''; loadTerrainManifest(url); }
        if (!terrainDemManifest && terrainDemManifestUrl) loadDemManifest(terrainDemManifestUrl);
        scheduleHydroRender();
      } else if (message.type === 'hydro-port') {
        connectHydroPort(message.port);
      } else if (message.type === 'hydro-edits') {
        const revision = Number(message.revision || 0);
        if (revision >= hydroEditRevision) {
          hydroEditRevision = revision;
          hydroEditFeatures = message.features || [];
          scheduleHydroRender();
        }
      } else if (message.type === 'hydro-pick') {
        try {
          self.postMessage({ type: 'hydro-pick', requestId: message.requestId, fid: pickHydroFeature(message.point) });
        } catch (error) {
          self.postMessage({ type: 'hydro-pick', requestId: message.requestId,
            error: { code: 'PL-CANVAS-HYDRO-PICK', message: error.message, stack: error.stack } });
        }
      } else if (message.type === 'data' || message.type === 'replace-data') {
        const incomingGeometryRevision = Number(message.geometryRevision || 0);
        const incomingGeneration = Number(message.projectGeneration ?? projectGeneration);
        if (incomingGeneration < projectGeneration) return;
        if (incomingGeneration > projectGeneration) {
          geometryRevision = 0; countrySharedBoundary = null; substrateState = null;
          hydroEditFeatures = []; hydroEditRevision = -1;
          lastRenderMessage = { ...lastRenderMessage, scenePolygons: [], sceneStrokes: [], interactionPolygons: [], interactionFillItems: [] };
        }
        if (incomingGeometryRevision < geometryRevision) {
          self.postMessage({
            type: 'data-ready', projectGeneration, revision: Number(message.revision || 0), geometryRevision,
            taskToken: Number(message.taskToken || 0), ids: message.ids || [],
            replaceAll: true, stale: true,
          });
          return;
        }
        features = replaceCountryFeatures(message.features || [], message.projectGeneration);
        if (message.fills) mergeRenderState({ fills: message.fills });
        geometryRevision = incomingGeometryRevision;
        projectGeneration = Number(message.projectGeneration || projectGeneration);
        // Keep the previously presented shared strokes until the matching
        // replacement is published. New generations retain only terrain resources.
        self.postMessage({
          type: 'data-ready', projectGeneration,
          revision: Number(message.revision || 0),
          geometryRevision,
          taskToken: Number(message.taskToken || 0),
          ids: message.ids || [],
          replaceAll: true,
        });
      } else if (message.type === 'patch') {
        const incomingGeometryRevision = Number(message.geometryRevision || 0);
        if (incomingGeometryRevision < geometryRevision) {
          self.postMessage({
            type: 'data-ready', projectGeneration, revision: Number(message.revision || 0), geometryRevision,
            taskToken: Number(message.taskToken || 0), ids: message.ids || [],
            replaceAll: false, stale: true,
          });
          return;
        }
        const updates = new Map((message.features || []).map(feature => [countryId(feature), feature]));
        const removed = new Set((message.removedIds || []).map(String));
        const seen = new Set();
        features = features.flatMap(feature => {
          const id = countryId(feature);
          if (removed.has(id)) return [];
          if (updates.has(id)) {
            seen.add(id);
            return [retainCountryGeometry(updates.get(id), feature)];
          }
          return [feature];
        });
        for (const [id, feature] of updates) if (!seen.has(id)) features.push(feature);
        if (message.fills) {
          const fills = { ...lastRenderMessage?.fills, ...message.fills };
          for (const id of removed) delete fills[id];
          mergeRenderState({ fills });
        }
        geometryRevision = incomingGeometryRevision;
        projectGeneration = Number(message.projectGeneration || projectGeneration);
        // Keep the previously presented shared strokes until the matching
        // replacement is published. A new project starts with a fresh Worker.
        self.postMessage({
          type: 'data-ready', projectGeneration,
          revision: Number(message.revision || 0),
          geometryRevision,
          taskToken: Number(message.taskToken || 0),
          ids: message.ids || [],
          replaceAll: false,
        });
      } else if (message.type === 'country-shared-boundary') {
        if (Number(message.geometryRevision) !== geometryRevision
          || Number(message.projectGeneration) !== projectGeneration) return;
        countrySharedBoundary = message.packet || null;
        if (countrySharedBoundary) mergeRenderState({ hiddenSharedCountryIds: message.hiddenSharedCountryIds || [],
          countryBoundaryStyles: message.countryBoundaryStyles });
        scheduleHydroRender();
      } else if (message.type === 'style') {
        const incomingRevision = Number(message.styleRevision || 0);
        if (incomingRevision < styleRevision) return;
        styleRevision = incomingRevision;
        mergeRenderState(message);
      } else if (message.type === 'physical-style') {
        const incomingRevision = Number(message.physicalStyleRevision || 0);
        if (incomingRevision < physicalStyleRevision) return;
        physicalStyleRevision = incomingRevision;
        terrainFetchConcurrency = Math.max(1, Math.min(4, Number(message.terrainFetchConcurrency || terrainFetchConcurrency)));
        mergeRenderState(message);
        pumpTerrainFetchQueue();
      } else if (message.type === 'view' || message.type === 'render') {
        try {
          const incomingRevision = Number(message.viewRevision || message.revision || 0);
          if (incomingRevision < viewRevision) {
            self.postMessage({ type: 'frame', renderRequestId: message.renderRequestId,
              projectGeneration: Number(message.projectGeneration || 0) });
            return;
          }
          viewRevision = incomingRevision;
          pumpTerrainFetchQueue();
          render(mergeRenderState(message), message.renderRequestId);
        } catch (error) {
          self.postMessage({ type: 'error', message: error?.stack || error?.message || String(error) });
        }
      }
    };
  }

canvasFallbackWorkerMain();
