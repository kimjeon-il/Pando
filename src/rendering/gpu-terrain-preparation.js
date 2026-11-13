import { resourceKey, resourceUpdate } from "./resource-update-policy.js";
import {createGpuNaturalSurfaceCache} from './gpu-natural-surface-cache.js';
import {terrainNaturalTileRequest,fetchTerrainTile} from '../data/terrain-manifest.js';
import "./workers/terrain-tile-selection-core.js";
// Owns terrain requests, retries, decoded bitmaps, upload queue, textures and grids.
// prepare() returns ready draw records; drawing never initiates preparation.
export function createGpuTerrainPreparation({ readTile, readNaturalTile = async (spec,manifest,signal) => {
  const request=terrainNaturalTileRequest(spec,manifest);
  return request ? fetchTerrainTile(request,{signal}) : null;
}, onUnusable, onTileFailure, isMobile, invalidate, geoDistance }) {
  const natural=createGpuNaturalSurfaceCache({readTile:readNaturalTile,invalidate});
  const PI = Math.PI;
  let gl = null, uploadScheduler = null, ready = false, disposed = false;
  let epoch = 0, projectGeneration = 0, contextRevision = 0;
  let activeFrameContext = null, view = {};
  let terrainManifest = null, cacheBudgetBytes = 128 * 1024 * 1024, terrainUploadCount = 0;
  let dependencies = { source: 'terrain', content: 'null', preparation: 'terrain-v1', context: null, presentation: 'tiles' };
  let pendingDecodedBytes = 0, unusableReported = false, tileFailureReported = false;
  let requiredKeys = new Set(), resolutionLimited = false, preparationFailure = '';
  const controllers = new Set(), retryTimers = new Set(), uploadKeys = new Set();
  const isWebGlRenderer = () => ready;
    const terrainTiles = new Map();
    const terrainTileRequests = new Map();
    const terrainFetchQueue = [];
    const terrainFetchQueuedEntries = new Map();
    let terrainActiveFetches = 0;
    const terrainTileFailures = new Map();
    const terrainTileQueuedKeys = new Set();
    const terrainUploadQueue = [];
    const terrainGridMeshes = new Map();
    let terrainLastLevel = -1;
    let terrainRenderedLevel = -1;
    let terrainTargetTileCount = 0;
    let terrainTargetTilesLoaded = 0;
    let terrainTargetTileKeys = new Set();
    let terrainRetentionKeys = new Set();
    // Retention includes the whole-world safety reserve and speculative
    // neighbours. Only tiles that can actually change the current viewport
    // may invalidate its colour surface after an upload or failure.
    let terrainCurrentViewKeys = new Set();
    let ignoredOffscreenTileCompletions = 0;
    function terrainAdmissionForView(frameContext = activeFrameContext) {
      if (!terrainManifest?.levels?.length) return null;
      const physicalScale = Number(frameContext?.scale) || Number(activeFrameContext?.scale) || 1;
      // Render DPR reduction must not degrade the selected source terrain.
      const frameDpr = Math.max(1, Number(frameContext.dpr));
      const sourceDpr = Math.min(isMobile() ? 2 : 3, Math.max(1, Number(view.devicePixelRatio || 1)));
      const desiredWidth = Math.max(1, 2 * PI * (physicalScale / frameDpr) * sourceDpr);
      const choice = tileSelection.admitVisibleTiles(terrainManifest, desiredWidth,
        level => visibleTerrainTileSpecs(level, false, frameContext));
      resolutionLimited = choice.resolutionLimited;
      return choice;
    }

    const tileSelection=globalThis.PandoLabTerrainTileSelection;
    const visibleTileCache=tileSelection.createVisibilityCache({ distance: geoDistance });
    const terrainNeighbourSpecs=tileSelection.neighbours;
    function visibleNaturalReserve(specs) {
      if (!view.visible || view.physicalStyle !== 'physical' || !terrainManifest?.naturalSurface) return 0;
      let total=0,selected=0;
      for(const spec of specs){
        if(selected===2)break;
        if(!terrainManifest.naturalSurface.tiles[`${spec.level}/${spec.column}-${spec.row}.webp`])continue;
        total+=(spec.pixelWidth+2*terrainManifest.gutter)*(spec.pixelHeight+2*terrainManifest.gutter)*4;
        selected++;
      }
      return total;
    }
    function visibleTerrainTileSpecs(level,includeAll=false,frameContext=activeFrameContext) {
      const rotation=frameContext?.viewState?.rotation||view.rotation;
      const viewport=frameContext?.viewport||[view.width,view.height];
      const flatCenter=frameContext?.viewState?.projectionCenter||view.flatCenter;
      const scale=Number(frameContext?.scale)||1;
      const projection=frameContext?.viewState?.projection||view.projection;
      const camera=[viewport[0],viewport[1],scale,projection,flatCenter?.[0],flatCenter?.[1],
        Number(rotation?.[0]||0),Number(rotation?.[1]||0)];
      return visibleTileCache.select(level,{
        cameraKey:camera,includeAll,viewport,scale,projection,flatCenter,
        globeCenter:[-camera[6],-camera[7]],
      });
    }

    function requestTerrainTile(spec, priority = 0, pump = true) {
      if (!gl || disposed || terrainTiles.has(spec.key) || terrainTileRequests.has(spec.key)
          || terrainTileQueuedKeys.has(spec.key)) return;
      const queued = terrainFetchQueuedEntries.get(spec.key);
      if (queued) {
        if (queued.priority !== Number(priority || 0)) {
          queued.priority = Number(priority || 0);
          sortTerrainFetchQueue();
        }
        return;
      }
      const previousFailure = terrainTileFailures.get(spec.key);
      if (previousFailure?.retryAt > performance.now()) return;
      const entry = { spec, priority: Number(priority || 0) };
      terrainFetchQueuedEntries.set(spec.key, entry);
      terrainFetchQueue.push(entry);
      sortTerrainFetchQueue();
      if (pump) pumpTerrainFetchQueue();
    }

    function sortTerrainFetchQueue() {
      terrainFetchQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
    }

    function pruneTerrainFetchQueue() {
      let retainedCount = 0;
      for (const entry of terrainFetchQueue) {
        if (!terrainRetentionKeys.has(entry.spec.key)) {
          terrainFetchQueuedEntries.delete(entry.spec.key);
          continue;
        }
        terrainFetchQueue[retainedCount++] = entry;
      }
      terrainFetchQueue.length = retainedCount;
    }

    const terrainFetchConcurrency = () => isMobile() ? 2 : terrainTargetTilesLoaded < terrainTargetTileCount ? 6 : 4;
    function pumpTerrainFetchQueue() {
      const concurrency = terrainFetchConcurrency();
      while (terrainActiveFetches < concurrency && pendingDecodedBytes < 32 * 1024 * 1024 && terrainFetchQueue.length) {
        const next = terrainFetchQueue.shift();
        terrainFetchQueuedEntries.delete(next.spec.key);
        startTerrainTileRequest(next.spec, next.priority);
      }
    }

    function startTerrainTileRequest(spec, priority = 0) {
      const previousFailure = terrainTileFailures.get(spec.key);
      const requestGeneration = epoch;
      const retainedAtStart = terrainRetentionKeys.has(spec.key);
      const controller = new AbortController();
      controllers.add(controller);
      terrainActiveFetches += 1;
      const request = (async () => {
        const blob = await readTile(spec, controller.signal);
        let bitmap;
        try { bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); }
        catch (error) {
          if (terrainManifest?.representation === 'dem-relief-v1') {
            error.demDecodeFailure = true;
            throw error;
          }
          bitmap = await createImageBitmap(blob);
        }
        if (terrainManifest?.representation === 'dem-relief-v1'
            && (bitmap.width !== spec.pixelWidth + terrainManifest.gutter * 2
              || bitmap.height !== spec.pixelHeight + terrainManifest.gutter * 2)) {
          bitmap.close?.();
          const error = new Error(`DEM tile dimensions differ from manifest: ${spec.key}`);
          error.demDecodeFailure = true;
          throw error;
        }
        if (requestGeneration !== epoch || disposed || controller.signal.aborted) {
          bitmap.close?.();
          return;
        }
        if (!gl || disposed || !isWebGlRenderer()) {
          bitmap.close?.();
          return;
        }
        terrainTileFailures.delete(spec.key);
        terrainTileQueuedKeys.add(spec.key);
        pendingDecodedBytes += bitmap.width * bitmap.height * 4;
        terrainUploadQueue.push({ spec, bitmap });
        scheduleTerrainUpload();
      })().catch(error => {
        if (requestGeneration !== epoch || disposed || controller.signal.aborted) return;
        if (error.demDecodeFailure && !unusableReported) {
          unusableReported = true;
          onUnusable?.(String(error?.message || error));
        }
        const attempts = Number(previousFailure?.attempts || 0) + 1;
        const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
        terrainTileFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay, error });
        if (attempts <= 3) {
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            if (requestGeneration === epoch && !disposed
                && (!retainedAtStart || terrainRetentionKeys.has(spec.key))) requestTerrainTile(spec, priority);
          }, retryDelay + 16);
          retryTimers.add(timer);
        }
        if (view.visible && terrainCurrentViewKeys.has(spec.key)) invalidate('terrain-tile-failed');
        else ignoredOffscreenTileCompletions += 1;
        console.warn(`지형 타일을 불러오지 못했습니다: ${spec.key}`, error);
      }).finally(() => {
        controllers.delete(controller);
        if (requestGeneration !== epoch || disposed) return;
        if (terrainTileRequests.get(spec.key)?.promise === request) terrainTileRequests.delete(spec.key);
        terrainActiveFetches = Math.max(0, terrainActiveFetches - 1);
        if (controller.signal.aborted && terrainTargetTileKeys.has(spec.key)) requestTerrainTile(spec, priority, false);
        pumpTerrainFetchQueue();
      });
      terrainTileRequests.set(spec.key, { promise: request, controller });
    }

    function uploadTerrainTile(next) {
      if (!next) return false;
      const { spec, bitmap } = next;
      const byteLength = Math.max(1, Number(bitmap.width || spec?.pixelWidth || 1))
        * Math.max(1, Number(bitmap.height || spec?.pixelHeight || 1)) * 4;
      pendingDecodedBytes = Math.max(0, pendingDecodedBytes - byteLength);
      if (spec) terrainTileQueuedKeys.delete(spec.key);
      if (!gl || disposed || !isWebGlRenderer()) {
        bitmap.close?.();
        return false;
      }
        const texture = gl.createTexture();
        const dem = terrainManifest?.representation === 'dem-relief-v1';
        const oldPremultiply = gl.getParameter?.(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
        const oldColorSpace = dem ? gl.getParameter?.(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL) : undefined;
        try {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (dem) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        } catch (error) { gl.deleteTexture(texture); throw error; }
        finally {
          if (oldPremultiply !== undefined) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, oldPremultiply);
          if (oldColorSpace !== undefined) gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, oldColorSpace);
          bitmap.close?.();
        }
        terrainTiles.set(spec.key, { texture, lastUsed: performance.now(), byteLength });
        terrainUploadCount += 1;
        let terrainBytes = [...terrainTiles.values()].reduce((sum, entry) => sum + Number(entry.byteLength || 0), 0);
        const terrainBudget = Math.max(8 * 1024 * 1024, Number(cacheBudgetBytes) || 128 * 1024 * 1024);
        natural.trim(Math.max(0,terrainBudget-terrainBytes-pendingDecodedBytes));
        while (terrainBytes > terrainBudget) {
          let oldest = null;
          for (const item of terrainTiles.entries()) {
            if (terrainRetentionKeys.has(item[0])) continue;
            if (!oldest || item[1].lastUsed < oldest[1].lastUsed) oldest = item;
          }
          if (!oldest || oldest[0] === spec?.key) break;
          gl.deleteTexture(oldest[1].texture);
          terrainTiles.delete(oldest[0]);
          terrainBytes -= Number(oldest[1].byteLength || 0);
        }
      return true;
    }

    function scheduleTerrainUpload() {
      if (!uploadScheduler || !terrainUploadQueue.length) return;
      const contextGeneration = contextRevision, uploadEpoch = epoch;
      const queue = terrainUploadQueue;
      const key = 'terrain:' + contextGeneration + ':' + uploadEpoch;
      // Exactly one scheduler owner per context/epoch. New decodes join its
      // queue; duplicate enqueue promises cannot accidentally dispose it.
      if (uploadKeys.has(key)) return;
      uploadKeys.add(key);
      void uploadScheduler.enqueueUpload({
        // Current-view DEM competes with many optional stroke/overlay uploads.
        // Decode order already chooses requiredKeys first; advance that
        // certified terrain before background overlay staging, without
        // bypassing the common per-frame GPU upload budget.
        key, contextGeneration, priority: 70, allowDuringInteraction: true,
        dispose: () => { if (uploadEpoch === epoch) discardUploads(queue); },
        step: () => {
          if (uploadEpoch !== epoch || disposed) throw Object.assign(new Error('Stale terrain upload'), { name: 'AbortError' });
          // Decoded neighbours cannot stand ahead of current-view coverage.
          const visibleIndex = terrainUploadQueue.findIndex(item => requiredKeys.has(item.spec?.key));
          const next = terrainUploadQueue.splice(Math.max(0, visibleIndex), 1)[0];
          const bytes = next ? next.bitmap.width * next.bitmap.height * 4 : 0;
          const uploaded = next && uploadTerrainTile(next);
          if (uploaded && next?.spec) {
            if (view.visible && terrainCurrentViewKeys.has(next.spec.key)) invalidate('terrain-tile-ready');
            else ignoredOffscreenTileCompletions += 1;
          }
          pumpTerrainFetchQueue();
          return { bytes, done: !terrainUploadQueue.length };
        },
      }).catch(error => {
        if (error.name !== 'AbortError') {
          console.warn('Terrain upload failed', error);
          preparationFailure = String(error?.message || error);
          invalidate('terrain-upload-failed');
          if (terrainManifest?.representation === 'dem-relief-v1' && !unusableReported) {
            unusableReported = true;
            onUnusable?.(String(error?.message || error));
          }
        }
      }).finally(() => {
        uploadKeys.delete(key);
        // A decode can arrive after the final step but before settlement.
        // Re-arm only after releasing the old key, so no tile is stranded.
        if (!disposed && uploadEpoch === epoch && terrainUploadQueue.length) scheduleTerrainUpload();
      });
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

    function prepare() {
      if (!view.visible || !terrainManifest?.levels?.length || !gl || disposed) {
        terrainCurrentViewKeys.clear();
        terrainRetentionKeys.clear();
        pruneTerrainFetchQueue();
        return [];
      }
      const frameContext = activeFrameContext;
      if (!frameContext) {
        terrainCurrentViewKeys.clear();
        terrainRetentionKeys.clear();
        pruneTerrainFetchQueue();
        return false;
      }
      const admission = terrainAdmissionForView(frameContext);
      const targetLevel = admission.level, targetSpecs = admission.specs;
      // Keep one complete world base, independent of camera/country detail.
      // It is also the coverage reserve when rotating into an uncached region.
      const baseLevel = terrainManifest.levels[0];
      const baseSpecs = visibleTerrainTileSpecs(baseLevel, true, frameContext);
      const baseKeys = new Set(baseSpecs.map(spec => spec.key));
      requiredKeys = new Set(targetSpecs.map(spec => spec.key));
      const baseReady = baseSpecs.every(spec => terrainTiles.has(spec.key));
      terrainLastLevel = Number(targetLevel?.id ?? -1);
      terrainTargetTileCount = targetSpecs.length;
      terrainTargetTilesLoaded = targetSpecs.filter(spec => terrainTiles.has(spec.key)).length;
      terrainTargetTileKeys = new Set(targetSpecs.map(spec => spec.key));
      terrainRetentionKeys = new Set([...terrainTargetTileKeys, ...baseKeys]);
      // Only GPU-ready textures replace coverage. Keep cached fallback tiles
      // over the missing target regions, including when zooming out, and pin
      // exactly those draw resources against eviction during replacement uploads.
      const missingSpecs = targetSpecs.filter(spec => !terrainTiles.has(spec.key));
      const drawSpecs = tileSelection.readyDrawSpecs(terrainManifest, targetLevel, targetSpecs,
        (level, all) => visibleTerrainTileSpecs(level, all, frameContext), key => terrainTiles.has(key));
      const fallbackSpecs = drawSpecs.filter(spec => Number(spec.level) !== Number(targetLevel.id));
      for (const spec of fallbackSpecs) terrainRetentionKeys.add(spec.key);
      // A retained overview tile is not necessarily visible. Track only
      // current target/fallback coverage; pending visible base tiles can also
      // change the picture while detail is still missing.
      const visibleBaseSpecs = missingSpecs.length && targetLevel !== baseLevel
        ? visibleTerrainTileSpecs(baseLevel, false, frameContext) : [];
      terrainCurrentViewKeys = new Set([
        ...targetSpecs, ...fallbackSpecs, ...visibleBaseSpecs,
      ].map(spec => spec.key));
      // Speculation starts only after current coverage reaches the GPU, and
      // only uses spare cache space. It must not block decoding visible tiles
      // or evict useful detail merely to fill an offscreen neighbour ring.
      const prefetchSpecs = [];
      if (baseReady && !missingSpecs.length) {
        const residentBytes = [...terrainTiles.values()].reduce((sum, tile) => sum + tile.byteLength, 0);
        // Optional observed imagery needs room before speculative DEM neighbours.
        // Reserve at most two visible natural tiles, but never reduce target DEM
        // completeness or add memory above the existing fixed terrain budget.
        const unusedNaturalReserve=Math.max(0,visibleNaturalReserve(targetSpecs)-natural.bytes()-natural.pendingBytes());
        let spareBytes = Math.max(0, cacheBudgetBytes - residentBytes - pendingDecodedBytes
          - natural.bytes() - natural.pendingBytes() - unusedNaturalReserve);
        for (const spec of terrainNeighbourSpecs(targetLevel, targetSpecs)) {
          if (terrainTargetTileKeys.has(spec.key) || terrainTiles.has(spec.key)) continue;
          const bytes = (spec.pixelWidth + 2 * terrainManifest.gutter) * (spec.pixelHeight + 2 * terrainManifest.gutter) * 4;
          if (!terrainTileQueuedKeys.has(spec.key)) {
            if (bytes > spareBytes) continue;
            spareBytes -= bytes;
          }
          prefetchSpecs.push(spec);
          terrainRetentionKeys.add(spec.key);
        }
      }
      pruneTerrainFetchQueue();
      const projection = frameContext.viewState?.projection || view.projection;
      const rotation = frameContext.viewState?.rotation || view.rotation;
      const center = projection === 'flat' ? frameContext.viewState?.projectionCenter || view.flatCenter
        : [-Number(rotation?.[0] || 0), -Number(rotation?.[1] || 0)];
      for (const spec of baseSpecs) requestTerrainTile(spec, 5_000, false);
      for (const spec of targetSpecs) {
        const [west, north, east, south] = spec.bounds;
        const tileCenter = [(west + east) / 2, (north + south) / 2];
        const distance = projection === 'flat'
          ? Math.hypot((((tileCenter[0] - center[0]) + 540) % 360) - 180, tileCenter[1] - center[1]) * PI / 180
          : geoDistance(center, tileCenter);
        requestTerrainTile(spec, 30_000 - distance * 1_000, false);
      }
      for (const spec of prefetchSpecs) requestTerrainTile(spec, 1_000, false);
      const visibleTilesWaiting = terrainFetchQueue.some(entry => terrainTargetTileKeys.has(entry.spec.key));
      for (const [key, request] of terrainTileRequests) {
        if (!terrainRetentionKeys.has(key)
            || (visibleTilesWaiting && !terrainTargetTileKeys.has(key))) request.controller.abort();
      }
      // Fill the current-view batch before starting fetches so array traversal
      // cannot consume all slots with far-away tiles ahead of the center.
      pumpTerrainFetchQueue();
      terrainRenderedLevel = -1;
      const prepared = [];
      // Camera scale selects detail, never visibility. Ready tiles replace
      // cached coverage only after their upload has completed.
      for (const spec of drawSpecs) {
        const tile = terrainTiles.get(spec.key);
        if (!tile) continue;
        tile.lastUsed = performance.now();
        prepared.push({ spec, texture: tile.texture, grid: terrainGridMesh(spec, frameContext), gutter: Number(terrainManifest.gutter || 0) });
        terrainRenderedLevel = Number(spec.level);
      }
      const exhausted = spec => Number(terrainTileFailures.get(spec.key)?.attempts || 0) >= 4;
      if (targetSpecs.length && !tileFailureReported
          && targetSpecs.some(exhausted)) {
        tileFailureReported = true;
        const failedBase = targetSpecs.find(exhausted);
        // A failed detail request must remain visible in diagnostics without
        // replacing a usable source and clearing its cached coverage.
        const reason = `지형 바탕 타일을 불러오지 못했습니다: ${failedBase.key}: ${terrainTileFailures.get(failedBase.key).error.message}`;
        if (prepared.length) onTileFailure?.(reason);
        else if (!unusableReported) { unusableReported = true; onUnusable?.(reason); }
      }
      return prepared;
    }

  function discardUploads(queue = terrainUploadQueue) {
    for (const item of queue.splice(0)) {
      if (item.spec) terrainTileQueuedKeys.delete(item.spec.key);
      pendingDecodedBytes = Math.max(0, pendingDecodedBytes - item.bitmap.width * item.bitmap.height * 4);
      item.bitmap.close?.();
    }
  }
  function reset() {
    natural.reset();
    for (const key of uploadKeys) uploadScheduler?.cancelKey?.(key);
    uploadKeys.clear();
    epoch++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    for (const timer of retryTimers) clearTimeout(timer);
    retryTimers.clear();
    discardUploads();
    terrainFetchQueue.length = 0; terrainFetchQueuedEntries.clear();
    terrainTileQueuedKeys.clear(); terrainTileRequests.clear(); terrainTileFailures.clear();
    terrainActiveFetches = 0;
    pendingDecodedBytes = 0; unusableReported = false; tileFailureReported = false;
    if (gl && !gl.isContextLost?.()) {
      for (const tile of terrainTiles.values()) gl.deleteTexture(tile.texture);
      for (const grid of terrainGridMeshes.values()) { gl.deleteBuffer(grid.vertexBuffer); gl.deleteBuffer(grid.indexBuffer); }
    }
    terrainTiles.clear(); terrainGridMeshes.clear();
    terrainLastLevel = -1; terrainRenderedLevel = -1;
    terrainTargetTileCount = 0; terrainTargetTilesLoaded = 0;
    terrainTargetTileKeys.clear(); terrainRetentionKeys.clear(); terrainCurrentViewKeys.clear();
    requiredKeys.clear(); resolutionLimited = false; preparationFailure = '';
  }
  const settled = () => [...terrainTargetTileKeys].every(key => terrainTiles.has(key) || Number(terrainTileFailures.get(key)?.attempts || 0) >= 4);
  function readiness() {
    return {
      terrainReady: requiredKeys.size > 0 && [...requiredKeys].every(key => terrainTiles.has(key)),
      terrainFailed: !!preparationFailure || [...requiredKeys].some(key => !terrainTiles.has(key) && Number(terrainTileFailures.get(key)?.attempts || 0) >= 4),
      terrainResolutionLimited: resolutionLimited,
      terrainTargetKey: `${projectGeneration}:${contextRevision}:${epoch}:${terrainLastLevel}:${[...requiredKeys].sort().join(',')}`,
    };
  }
  return Object.freeze({
    setContext(next) {
      if (disposed) return;
      const nextDependencies = { ...dependencies, context: next.gl ? [next.gl, next.contextGeneration] : null };
      const change = resourceUpdate(dependencies, nextDependencies);
      if (change.upload) reset();
      dependencies = nextDependencies;
      gl = next.gl; ready = next.ready; uploadScheduler = next.scheduler;
      projectGeneration = next.projectGeneration; contextRevision = next.contextGeneration;
    },
    setManifest(manifest) {
      visibleTileCache.clear();
      // Optional surface-catalog admission must never dispose already uploaded
      // numerical DEM textures or force another terrain download.
      const {naturalSurface:unusedNatural, ...demSource} = manifest || {};
      const next = { ...dependencies, content: resourceKey(manifest ? demSource : null) };
      const demChanged = resourceUpdate(dependencies, next).input;
      const surfaceChanged = resourceKey(terrainManifest?.naturalSurface ?? null)
        !== resourceKey(manifest?.naturalSurface ?? null);
      if (demChanged) reset();
      else if (surfaceChanged) natural.reset();
      dependencies = next; terrainManifest = manifest;
    },
    prepare(frame, nextView) {
      activeFrameContext=frame;view=nextView;cacheBudgetBytes=nextView.cacheBudgetBytes;
      const prepared=prepare()||[];
      let demBytes=[...terrainTiles.values()].reduce((n,t)=>n+t.byteLength,0);
      const unusedNaturalReserve=Math.max(0,visibleNaturalReserve(prepared.map(record=>record.spec))
        -natural.bytes()-natural.pendingBytes());
      const desiredDemCeiling=Math.max(0,cacheBudgetBytes-pendingDecodedBytes-unusedNaturalReserve
        -natural.bytes()-natural.pendingBytes());
      // A natural request can start before speculative DEM neighbours finish.
      // Remove only *offscreen* DEM textures, never target/fallback terrain.
      // This prevents subsequent DEM uploads from aborting every natural request
      // in a 64 MiB cache while preserving the same total GPU budget.
      if(unusedNaturalReserve>0 && gl && demBytes>desiredDemCeiling){
        const removable=[...terrainTiles.entries()]
          .filter(([key])=>!terrainCurrentViewKeys.has(key))
          .sort((a,b)=>Number(b[0].split('/')[0])-Number(a[0].split('/')[0])
            || a[1].lastUsed-b[1].lastUsed);
        for(const [key,entry] of removable){
          if(demBytes<=desiredDemCeiling)break;
          if(!gl.isContextLost?.())gl.deleteTexture(entry.texture);
          terrainTiles.delete(key);
          demBytes-=entry.byteLength;
        }
      }
      natural.prepare(prepared,{gl,scheduler:uploadScheduler,manifest:terrainManifest,contextGeneration:contextRevision,
        enabled:!!view.visible&&view.physicalStyle==='physical',requiredReady:readiness().terrainReady,
        budgetBytes:Math.max(0,cacheBudgetBytes-demBytes-pendingDecodedBytes)});
      return prepared;
    },
    request: requestTerrainTile,
    scheduleUpload: scheduleTerrainUpload,
    settled, reset,
    retry() {
      natural.retry();
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear(); terrainTileFailures.clear(); preparationFailure = ''; unusableReported = false; tileFailureReported = false;
      invalidate('terrain-retry');
    },
    stats: () => ({ ...readiness(), terrainLevel: terrainLastLevel, terrainRenderedLevel, terrainTargetTileCount, terrainTargetTilesLoaded,
      terrainTargetTilesSettled: settled(), terrainTilesLoaded: terrainTiles.size,
      terrainCacheBytes: [...terrainTiles.values()].reduce((sum, tile) => sum + tile.byteLength, 0)+natural.bytes(),
      ...natural.stats(),
      terrainPendingDecodedBytes: pendingDecodedBytes,
      terrainTilesLoading: terrainTileRequests.size + terrainFetchQueue.length, terrainFetchConcurrency: terrainFetchConcurrency(),
      terrainUploadCount, terrainFailureCount: terrainTileFailures.size,
      terrainIgnoredOffscreenCompletionCount: ignoredOffscreenTileCompletions }),
    dispose() { if (disposed) return; reset(); disposed = true; gl = null; uploadScheduler = null; },
  });
}
