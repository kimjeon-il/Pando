// Owns terrain requests, retries, decoded bitmaps, upload queue, textures and grids.
// prepare() returns ready draw records; drawing never initiates preparation.
export function createGpuTerrainPreparation({ tileUrl, isMobile, invalidate, geoDistance }) {
  const PI = Math.PI;
  let gl = null, uploadScheduler = null, ready = false, disposed = false;
  let epoch = 0, projectGeneration = 0, contextRevision = 0;
  let activeFrameContext = null, effectivePixelRatio = 1, view = {};
  let terrainManifest = null, cacheBudgetBytes = 128 * 1024 * 1024, terrainUploadCount = 0;
  const controllers = new Set(), retryTimers = new Set(), uploadKeys = new Set();
  const isWebGlRenderer = () => ready;
    const terrainTiles = new Map();
    const terrainTileRequests = new Map();
    const terrainFetchQueue = [];
    const terrainFetchQueuedKeys = new Set();
    let terrainActiveFetches = 0;
    const terrainTileFailures = new Map();
    const terrainTileQueuedKeys = new Set();
    const terrainUploadQueue = [];
    const terrainGridMeshes = new Map();
    let terrainLastLevel = -1;
    let terrainRenderedLevel = -1;
    let terrainTargetTileCount = 0;
    let terrainTargetTilesLoaded = 0;
    let terrainFallbackTileCount = 0;
    let terrainTargetTileKeys = new Set();
    let terrainRetentionKeys = new Set();
    function terrainLevelForView(frameContext = activeFrameContext) {
      if (!terrainManifest?.levels?.length) return null;
      const physicalScale = Number(frameContext?.scale) || Number(activeFrameContext?.scale) || 1;
      // The render canvas may lower its DPR under load, but that must not
      // choose a blurrier source terrain level for an unchanged map view.
      const renderDpr = Math.max(1, Number(effectivePixelRatio || 1));
      const sourceDpr = Math.min(isMobile() ? 2 : 3, Math.max(1, Number(view.devicePixelRatio || 1)));
      const desiredWidth = Math.max(1, 2 * PI * (physicalScale / renderDpr) * sourceDpr);
      return terrainManifest.levels.find(level => level.width >= desiredWidth * 1.12)
        || terrainManifest.levels[terrainManifest.levels.length - 1];
    }

    function terrainTileSpec(level, column, row) {
      const x0 = column * level.tileSize;
      const y0 = row * level.tileSize;
      const x1 = Math.min(level.width, x0 + level.tileSize);
      const y1 = Math.min(level.height, y0 + level.tileSize);
      return {
        key: `${level.id}/${column}-${row}`,
        level: level.id,
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

    function terrainTileAt(level, longitude, latitude) {
      if (!level) return null;
      const x = Math.min(level.width - Number.EPSILON, Math.max(0, (Number(longitude) + 180) / 360 * level.width));
      const y = Math.min(level.height - Number.EPSILON, Math.max(0, (90 - Number(latitude)) / 180 * level.height));
      return terrainTileSpec(level, Math.floor(x / level.tileSize), Math.floor(y / level.tileSize));
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

    function visibleTerrainTileSpecs(level, includeAll = false, frameContext = activeFrameContext) {
      const specs = [];
      const viewport = frameContext?.viewport || [view.width, view.height];
      const scale = Number(frameContext?.scale) || 1;
      const flatHalfLon = viewport[0] / Math.max(1, scale) * 90 / PI;
      const flatHalfLat = viewport[1] / Math.max(1, scale) * 90 / PI;
      const rotation = frameContext?.viewState?.rotation || view.rotation;
      const flatCenter = frameContext?.viewState?.projectionCenter || view.flatCenter;
      const globeCenter = [-Number(rotation?.[0] || 0), -Number(rotation?.[1] || 0)];
      const globeRadius = Math.asin(Math.min(1, Math.hypot(viewport[0], viewport[1]) * 0.5 / Math.max(1, scale)));
      for (let row = 0; row < level.rows; row += 1) {
        for (let column = 0; column < level.columns; column += 1) {
          const spec = terrainTileSpec(level, column, row);
          if (includeAll) {
            specs.push(spec);
            continue;
          }
          const [west, north, east, south] = spec.bounds;
          const center = [(west + east) / 2, (north + south) / 2];
          const halfLon = (east - west) / 2;
          const halfLat = (north - south) / 2;
          const projectionKind = frameContext?.viewState?.projection || view.projection;
          if (projectionKind === 'flat') {
            const deltaLon = Math.abs((((center[0] - flatCenter[0]) + 540) % 360) - 180);
            const deltaLat = Math.abs(center[1] - flatCenter[1]);
            if (deltaLon <= flatHalfLon + halfLon + 2 && deltaLat <= flatHalfLat + halfLat + 2) specs.push(spec);
          } else {
            const padding = Math.hypot(halfLon, halfLat) * PI / 180;
            if (geoDistance(globeCenter, center) <= globeRadius + padding + 0.04) specs.push(spec);
          }
        }
      }
      return specs;
    }

    function requestTerrainTile(spec, priority = 0) {
      if (!gl || disposed || terrainTiles.has(spec.key) || terrainTileRequests.has(spec.key)
          || terrainTileQueuedKeys.has(spec.key) || terrainFetchQueuedKeys.has(spec.key)) return;
      const previousFailure = terrainTileFailures.get(spec.key);
      if (previousFailure?.retryAt > performance.now()) return;
      terrainFetchQueuedKeys.add(spec.key);
      terrainFetchQueue.push({ spec, priority: Number(priority || 0) });
      terrainFetchQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
      pumpTerrainFetchQueue();
    }

    function pumpTerrainFetchQueue() {
      const concurrency = isMobile() ? 2 : 4;
      while (terrainActiveFetches < concurrency && terrainFetchQueue.length) {
        const next = terrainFetchQueue.shift();
        terrainFetchQueuedKeys.delete(next.spec.key);
        startTerrainTileRequest(next.spec, next.priority);
      }
    }

    function startTerrainTileRequest(spec, priority = 0) {
      const previousFailure = terrainTileFailures.get(spec.key);
      const requestGeneration = epoch;
      const controller = new AbortController();
      controllers.add(controller);
      terrainActiveFetches += 1;
      const request = (async () => {
        const response = await fetch(tileUrl(spec), { signal: controller.signal });
        if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
        const blob = await response.blob();
        let bitmap;
        try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
        catch (_) { bitmap = await createImageBitmap(blob); }
        if (requestGeneration !== epoch || disposed) {
          bitmap.close?.();
          return;
        }
        if (!gl || disposed || !isWebGlRenderer()) {
          bitmap.close?.();
          return;
        }
        terrainTileFailures.delete(spec.key);
        terrainTileQueuedKeys.add(spec.key);
        terrainUploadQueue.push({ spec, bitmap });
        scheduleTerrainUpload();
      })().catch(error => {
        if (requestGeneration !== epoch || disposed || controller.signal.aborted) return;
        const attempts = Number(previousFailure?.attempts || 0) + 1;
        const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
        terrainTileFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay });
        if (attempts <= 3) {
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            if (requestGeneration === epoch && !disposed) requestTerrainTile(spec, priority);
          }, retryDelay + 16);
          retryTimers.add(timer);
        }
        if (terrainRetentionKeys.has(spec.key)) invalidate('terrain-tile-failed');
        console.warn(`지형 타일을 불러오지 못했습니다: ${spec.key}`, error);
      }).finally(() => {
        controllers.delete(controller);
        if (requestGeneration !== epoch || disposed) return;
        if (terrainTileRequests.get(spec.key) === request) terrainTileRequests.delete(spec.key);
        terrainActiveFetches = Math.max(0, terrainActiveFetches - 1);
        pumpTerrainFetchQueue();
      });
      terrainTileRequests.set(spec.key, request);
    }

    function uploadTerrainTile(next) {
      if (!next) return false;
      const { spec, bitmap } = next;
      const byteLength = Math.max(1, Number(bitmap.width || spec.pixelWidth || 1))
        * Math.max(1, Number(bitmap.height || spec.pixelHeight || 1)) * 4;
      terrainTileQueuedKeys.delete(spec.key);
      if (!gl || disposed || !isWebGlRenderer()) {
        bitmap.close?.();
        return false;
      }
        const texture = gl.createTexture();
        try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        } catch (error) { gl.deleteTexture(texture); throw error; }
        finally { bitmap.close?.(); }
        terrainTiles.set(spec.key, { texture, lastUsed: performance.now(), byteLength });
        terrainUploadCount += 1;
        let terrainBytes = [...terrainTiles.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0);
        const terrainBudget = Math.max(8 * 1024 * 1024, Number(cacheBudgetBytes) || 128 * 1024 * 1024);
        while (terrainBytes > terrainBudget) {
          let oldest = null;
          for (const item of terrainTiles.entries()) {
            if (terrainRetentionKeys.has(item[0])) continue;
            if (!oldest || item[1].lastUsed < oldest[1].lastUsed) oldest = item;
          }
          if (!oldest || oldest[0] === spec.key) break;
          gl.deleteTexture(oldest[1].texture);
          terrainTiles.delete(oldest[0]);
          terrainBytes -= Number(oldest[1].byteLength || 0);
        }
      return true;
    }

    function scheduleTerrainUpload() {
      if (!uploadScheduler || !terrainUploadQueue.length) return;
      const generation = projectGeneration, contextGeneration = contextRevision, uploadEpoch = epoch;
      const queue = terrainUploadQueue;
      const key = 'terrain:' + generation + ':' + contextGeneration + ':' + uploadEpoch;
      uploadKeys.add(key);
      void uploadScheduler.enqueueUpload({
        key, projectGeneration: generation, contextGeneration, priority: 40,
        dispose: () => { if (uploadEpoch === epoch) discardUploads(queue); },
        step: () => {
          if (uploadEpoch !== epoch || disposed) throw Object.assign(new Error('Stale terrain upload'), { name: 'AbortError' });
          const next = terrainUploadQueue.shift();
          const bytes = next ? next.bitmap.width * next.bitmap.height * 4 : 0;
          const uploaded = next && uploadTerrainTile(next);
          if (uploaded && next && terrainRetentionKeys.has(next.spec.key)) invalidate('terrain-tile-ready');
          return { bytes, done: !terrainUploadQueue.length };
        },
      }).catch(error => { if (error.name !== 'AbortError') console.warn('Terrain upload failed', error); }).finally(() => uploadKeys.delete(key));
    }

    function terrainGridMesh(spec, frameContext = activeFrameContext) {
      const spanLon = Math.abs(spec.bounds[2] - spec.bounds[0]);
      const spanLat = Math.abs(spec.bounds[1] - spec.bounds[3]);
      // Equirectangular terrain is affine inside a tile, so four vertices are
      // exact. On the globe, tessellate only enough to keep spherical chord
      // error below roughly one physical pixel. The old fixed 0.499-degree
      // grid generated hundreds of thousands of triangles for a single
      // overview tile and saturated mobile GPUs without improving the raster.
      const globe = Number(frameContext?.mode) === 0;
      const scale = Math.max(1, Number(frameContext?.scale) || 1);
      const angularStep = globe
        ? Math.max(0.75, Math.min(8, Math.sqrt(4 / scale) * 180 / PI))
        : 360;
      const stepsX = Math.max(1, Math.ceil(spanLon / angularStep));
      const stepsY = Math.max(1, Math.ceil(spanLat / angularStep));
      const key = `${globe ? 'globe' : 'flat'}:${stepsX}x${stepsY}`;
      if (terrainGridMeshes.has(key)) return terrainGridMeshes.get(key);
      const vertices = new Float32Array((stepsX + 1) * (stepsY + 1) * 2);
      let vertexOffset = 0;
      for (let y = 0; y <= stepsY; y += 1) {
        for (let x = 0; x <= stepsX; x += 1) {
          vertices[vertexOffset++] = x / stepsX;
          vertices[vertexOffset++] = y / stepsY;
        }
      }
      const indices = new Uint32Array(stepsX * stepsY * 6);
      let indexOffset = 0;
      for (let y = 0; y < stepsY; y += 1) {
        for (let x = 0; x < stepsX; x += 1) {
          const a = y * (stepsX + 1) + x;
          const b = a + 1;
          const c = a + stepsX + 1;
          const d = c + 1;
          indices[indexOffset++] = a; indices[indexOffset++] = c; indices[indexOffset++] = b;
          indices[indexOffset++] = b; indices[indexOffset++] = c; indices[indexOffset++] = d;
        }
      }
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      const meshEntry = { vertexBuffer, indexBuffer, indexCount: indices.length };
      terrainGridMeshes.set(key, meshEntry);
      return meshEntry;
    }

    function terrainCandidateLevels(frameContext = activeFrameContext) {
      if (!frameContext) return [];
      const levels = terrainManifest.levels;
      const baseLevel = levels[0];
      const targetLevel = terrainLevelForView(frameContext) || baseLevel;
      const targetIndex = Math.max(0, levels.findIndex(level => Number(level.id) === Number(targetLevel.id)));
      const candidateLevels = levels.slice(0, (view.enhanced ? targetIndex : 0) + 1).reverse();
      return candidateLevels.map(level => ({
        level,
        specs: visibleTerrainTileSpecs(level, false, frameContext),
      }));
    }

    function prepare() {
      if (!view.visible || !terrainManifest?.levels?.length || !gl || disposed) return [];
      const frameContext = activeFrameContext;
      if (!frameContext) return false;
      const specsByLevel = terrainCandidateLevels(frameContext);
      const targetSpecs = specsByLevel[0]?.specs || [];
      const targetLevel = specsByLevel[0]?.level || null;
      terrainLastLevel = Number(targetLevel?.id ?? -1);
      terrainTargetTileCount = targetSpecs.length;
      terrainTargetTilesLoaded = targetSpecs.filter(spec => terrainTiles.has(spec.key)).length;
      terrainFallbackTileCount = 0;
      terrainTargetTileKeys = new Set(targetSpecs.map(spec => spec.key));
      terrainRetentionKeys = new Set(specsByLevel.flatMap(entry => entry.specs.map(spec => spec.key)));
      if (targetLevel) for (const spec of terrainNeighbourSpecs(targetLevel, targetSpecs)) terrainRetentionKeys.add(spec.key);
      for (let index = 0; index < specsByLevel.length; index += 1) {
        const priority = index === 0 ? 10_000 : 1_000 - index;
        for (const spec of specsByLevel[index].specs) requestTerrainTile(spec, priority);
      }
      if (targetLevel) for (const spec of terrainNeighbourSpecs(targetLevel, targetSpecs)) requestTerrainTile(spec, 120);
      terrainRenderedLevel = -1;
      const prepared = [];
      for (const spec of targetSpecs) {
        let sourceSpec = terrainTiles.has(spec.key) ? spec : null;
        if (!sourceSpec) {
          const centerLongitude = (spec.bounds[0] + spec.bounds[2]) / 2;
          const centerLatitude = (spec.bounds[1] + spec.bounds[3]) / 2;
          for (let index = 1; index < specsByLevel.length; index += 1) {
            const candidate = terrainTileAt(specsByLevel[index].level, centerLongitude, centerLatitude);
            if (candidate && terrainTiles.has(candidate.key)) {
              sourceSpec = candidate;
              break;
            }
          }
        }
        if (!sourceSpec) continue;
        const tile = terrainTiles.get(sourceSpec.key);
        tile.lastUsed = performance.now();
        prepared.push({ spec, sourceSpec, texture: tile.texture, grid: terrainGridMesh(spec, frameContext), gutter: Number(terrainManifest.gutter || 0) });
        terrainRenderedLevel = terrainRenderedLevel < 0 ? Number(sourceSpec.level) : Math.min(terrainRenderedLevel, Number(sourceSpec.level));
        if (sourceSpec.key !== spec.key) terrainFallbackTileCount += 1;
      }
      return prepared;
    }


  function discardUploads(queue = terrainUploadQueue) {
    for (const item of queue.splice(0)) { terrainTileQueuedKeys.delete(item.spec.key); item.bitmap.close?.(); }
  }
  function reset() {
    for (const key of uploadKeys) uploadScheduler?.cancelKey?.(key);
    uploadKeys.clear();
    epoch++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();
    discardUploads();
    terrainFetchQueue.length = 0; terrainFetchQueuedKeys.clear();
    terrainTileQueuedKeys.clear(); terrainTileRequests.clear(); terrainTileFailures.clear();
    terrainActiveFetches = 0;
    if (gl && !gl.isContextLost?.()) {
      for (const tile of terrainTiles.values()) gl.deleteTexture(tile.texture);
      for (const grid of terrainGridMeshes.values()) { gl.deleteBuffer(grid.vertexBuffer); gl.deleteBuffer(grid.indexBuffer); }
    }
    terrainTiles.clear(); terrainGridMeshes.clear();
    terrainLastLevel = -1; terrainRenderedLevel = -1;
    terrainTargetTileCount = 0; terrainTargetTilesLoaded = 0; terrainFallbackTileCount = 0;
    terrainTargetTileKeys.clear(); terrainRetentionKeys.clear();
  }
  const settled = () => [...terrainTargetTileKeys].every(key => terrainTiles.has(key) || Number(terrainTileFailures.get(key)?.attempts || 0) >= 4);
  return Object.freeze({
    setContext(next) {
      if (disposed) return;
      if (gl !== next.gl || projectGeneration !== next.projectGeneration || contextRevision !== next.contextGeneration) reset();
      gl = next.gl; ready = next.ready; uploadScheduler = next.scheduler;
      projectGeneration = next.projectGeneration; contextRevision = next.contextGeneration;
    },
    setManifest(manifest) { if (terrainManifest !== manifest) reset(); terrainManifest = manifest; },
    prepare(frame, nextView) { activeFrameContext = frame; view = nextView; effectivePixelRatio = nextView.dpr; cacheBudgetBytes = nextView.cacheBudgetBytes; return prepare() || []; },
    request: requestTerrainTile,
    scheduleUpload: scheduleTerrainUpload,
    settled, reset,
    stats: () => ({ terrainLevel: terrainLastLevel, terrainRenderedLevel, terrainTargetTileCount, terrainTargetTilesLoaded,
      terrainTargetTilesSettled: settled(), terrainFallbackTileCount, terrainTilesLoaded: terrainTiles.size,
      terrainCacheBytes: [...terrainTiles.values()].reduce((sum, tile) => sum + tile.byteLength, 0),
      terrainTilesLoading: terrainTileRequests.size + terrainFetchQueue.length, terrainFetchConcurrency: isMobile() ? 2 : 4,
      terrainUploadCount, terrainFailureCount: terrainTileFailures.size }),
    dispose() { if (disposed) return; reset(); disposed = true; gl = null; uploadScheduler = null; },
  });
}
