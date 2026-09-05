'use strict';
importScripts('../vendor/d3.min.js', './geographic-boundary-core.js');

function canvasFallbackWorkerMain() {
    let canvas = null;
    let context = null;
    let features = [];
    let geometryRevision = 0;
    let terrainManifest = null;
    let terrainManifestUrl = '';
    const terrainTiles = new Map();
    const terrainRequests = new Map();
    const terrainFetchQueue = [];
    const terrainQueuedKeys = new Set();
    const terrainFailures = new Map();
    let terrainActiveFetches = 0;
    let terrainFetchConcurrency = 2;
    const hydroPacks = new Map();
    let hydroEditFeatures = [];
    let hydroEditRevision = -1;
    let hydroActivePackIds = new Set();
    let hydroPort = null;
    let lastRenderMessage = null;
    let viewRevision = 0;
    let styleRevision = 0;
    let physicalStyleRevision = 0;
    let hydroRenderTimer = 0;
    const countryOutlineCache = new WeakMap();

    function mergeRenderState(message) {
      lastRenderMessage = { ...(lastRenderMessage || {}), ...message, type: 'render' };
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

    function terrainTileUrl(spec) {
      const relative = terrainManifest.urlTemplate
        .replace('{level}', String(spec.level))
        .replace('{column}', String(spec.column))
        .replace('{row}', String(spec.row));
      return new URL(relative, new URL('../../', terrainManifestUrl)).href;
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

    function requestTerrainTile(spec, priority = 0) {
      if (!terrainManifest || terrainTiles.has(spec.key) || terrainRequests.has(spec.key) || terrainQueuedKeys.has(spec.key)) return;
      const previousFailure = terrainFailures.get(spec.key);
      if (previousFailure?.retryAt > performance.now()) return;
      terrainQueuedKeys.add(spec.key);
      terrainFetchQueue.push({ spec, priority: Number(priority || 0) });
      terrainFetchQueue.sort((left, right) => right.priority - left.priority || left.spec.key.localeCompare(right.spec.key));
      pumpTerrainFetchQueue();
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
      terrainActiveFetches += 1;
      const request = fetch(terrainTileUrl(spec))
        .then(response => {
          if (!response.ok) throw new Error(`지형 타일 HTTP ${response.status}`);
          return response.blob();
        })
        .then(prepareTerrainBitmap)
        .then(images => {
          terrainFailures.delete(spec.key);
          terrainTiles.set(spec.key, { ...images, lastUsed: performance.now() });
          while (terrainTiles.size > 40) {
            const oldest = [...terrainTiles.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
            if (!oldest || oldest[0] === spec.key) break;
            terrainTiles.delete(oldest[0]);
          }
          self.postMessage({ type: 'terrain-ready', count: terrainTiles.size, key: spec.key });
        })
        .catch(error => {
          const attempts = Number(previousFailure?.attempts || 0) + 1;
          const retryDelay = attempts <= 3 ? Math.min(4000, 400 * 2 ** (attempts - 1)) : 30000;
          terrainFailures.set(spec.key, { attempts, retryAt: performance.now() + retryDelay });
          if (attempts <= 3) setTimeout(() => requestTerrainTile(spec, priority), retryDelay);
          self.postMessage({ type: 'terrain-warning', message: error?.message || String(error) });
        })
        .finally(() => {
          terrainRequests.delete(spec.key);
          terrainActiveFetches = Math.max(0, terrainActiveFetches - 1);
          pumpTerrainFetchQueue();
        });
      terrainRequests.set(spec.key, request);
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
        self.postMessage({ type: 'terrain-warning', message: error?.message || String(error) });
      }
    }

    function terrainLevelForView(projection, dpr) {
      if (!terrainManifest?.levels?.length) return null;
      const desiredWidth = Math.max(1, 2 * Math.PI * projection.scale() * dpr);
      return terrainManifest.levels.find(level => level.width >= desiredWidth * 1.12)
        || terrainManifest.levels[terrainManifest.levels.length - 1];
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

    function affineTransform(sourcePoints, destinationPoints) {
      const [s0, s1, s2] = sourcePoints;
      const [d0, d1, d2] = destinationPoints;
      const denominator = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
      if (Math.abs(denominator) < 1e-7) return null;
      const coefficients = values => [
        (values[0] * (s1[1] - s2[1]) + values[1] * (s2[1] - s0[1]) + values[2] * (s0[1] - s1[1])) / denominator,
        (values[0] * (s2[0] - s1[0]) + values[1] * (s0[0] - s2[0]) + values[2] * (s1[0] - s0[0])) / denominator,
        (values[0] * (s1[0] * s2[1] - s2[0] * s1[1]) + values[1] * (s2[0] * s0[1] - s0[0] * s2[1]) + values[2] * (s0[0] * s1[1] - s1[0] * s0[1])) / denominator,
      ];
      const x = coefficients([d0[0], d1[0], d2[0]]);
      const y = coefficients([d0[1], d1[1], d2[1]]);
      return [x[0], y[0], x[1], y[1], x[2], y[2]];
    }

    function drawTexturedTriangle(image, sourcePoints, destinationPoints, dpr) {
      const transform = affineTransform(sourcePoints, destinationPoints);
      if (!transform || destinationPoints.some(point => !point || !point.every(Number.isFinite))) return;
      context.save();
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.beginPath();
      context.moveTo(destinationPoints[0][0], destinationPoints[0][1]);
      context.lineTo(destinationPoints[1][0], destinationPoints[1][1]);
      context.lineTo(destinationPoints[2][0], destinationPoints[2][1]);
      context.closePath();
      context.clip();
      context.setTransform(dpr * transform[0], dpr * transform[1], dpr * transform[2], dpr * transform[3], dpr * transform[4], dpr * transform[5]);
      context.drawImage(image, 0, 0);
      context.restore();
    }

    function drawFlatTerrainTile(spec, image, projection, dpr) {
      const gutter = Number(terrainManifest.gutter || 0);
      const [west, north, east, south] = spec.bounds;
      for (const offset of [-360, 0, 360]) {
        const topLeft = projection([west + offset, north]);
        const bottomRight = projection([east + offset, south]);
        if (!topLeft || !bottomRight) continue;
        context.drawImage(
          image,
          gutter,
          gutter,
          spec.pixelWidth,
          spec.pixelHeight,
          topLeft[0] * dpr,
          topLeft[1] * dpr,
          (bottomRight[0] - topLeft[0]) * dpr,
          (bottomRight[1] - topLeft[1]) * dpr,
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

    function renderTerrain(message, projection, width, height, dpr) {
      if (!message.physicalSettings?.terrainVisible || !terrainManifest?.levels?.length) return true;
      const levels = terrainManifest.levels;
      const baseLevel = levels[0];
      const targetLevel = terrainLevelForView(projection, dpr) || baseLevel;
      const targetIndex = Math.max(0, levels.findIndex(level => Number(level.id) === Number(targetLevel.id)));
      const activeTargetIndex = message.dataReadiness === 'enhanced' ? targetIndex : 0;
      const specsByLevel = levels.slice(0, activeTargetIndex + 1).map((level, index) => ({
        level,
        specs: visibleTerrainTileSpecs(level, message, projection, width, height, false),
      }));
      const targetSpecs = specsByLevel[specsByLevel.length - 1]?.specs || [];
      const terrainComplete = targetSpecs.every(spec => terrainTiles.has(spec.key));
      for (let index = 0; index < specsByLevel.length; index += 1) {
        const priority = index === 0 ? 10_000 : 1_000 - index;
        for (const spec of specsByLevel[index].specs) requestTerrainTile(spec, priority);
      }
      const style = message.physicalSettings.terrainStyle === 'physical' ? 'physical' : 'political';
      context.save();
      context.globalAlpha = 1;
      context.filter = message.darkTheme ? 'brightness(0.84)' : 'none';
      if (style === 'political') {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.beginPath();
        self.d3.geo.path().projection(projection).context(context)({ type: 'FeatureCollection', features });
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
      for (let levelIndex = 0; levelIndex < specsByLevel.length; levelIndex += 1) {
        for (const spec of specsByLevel[levelIndex].specs) {
          const tile = terrainTiles.get(spec.key);
          if (!tile) continue;
          tile.lastUsed = performance.now();
          const image = tile[style];
          if (message.projection === 'flat') drawFlatTerrainTile(spec, image, projection, dpr);
          else drawGlobeTerrainTile(spec, image, projection, message, dpr, levelIndex === 0);
        }
      }
      context.restore();
      return terrainComplete;
    }

    function createProjection(message, width, height) {
      const view = message.view || {};
      if (message.projection === 'globe') {
        const base = Math.max(60, Math.min(width, height - 26) * 0.455);
        return self.d3.geo.orthographic()
          .translate([width / 2, height / 2])
          .scale(base * Number(view.globeZoom || 1))
          .rotate(view.globeRotation || [-15, -25, 0])
          .clipAngle(90)
          .precision(0.35);
      }
      const base = Math.max(30, width / (2 * Math.PI));
      return self.d3.geo.mercator()
        .translate([width / 2, height / 2])
        .scale(base * Number(view.flatZoom || 1))
        .center(view.flatCenter || [0, 20])
        .rotate([0, 0, 0])
        .clipExtent([[0, 0], [width, height - 25]])
        .precision(0.25);
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
      if (message.physicalSettings?.hiddenHydroIds?.[String(properties.pandolab_id || feature.id)] === true) return false;
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

    function renderHydroPass(message, projection, dpr, borderAligned) {
      const geoPath = self.d3.geo.path().projection(projection).context(context);
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
          if (borderAligned) continue;
          context.beginPath();
          geoPath(feature);
          context.globalAlpha = hydroOpacity;
          context.fillStyle = featureColor;
          context.fill();
          if (message.theme?.lakeBoundaryVisible !== false) {
            const boundary = self.PandoLabGeographicBoundary.buildRenderableBoundarySegments(feature);
            if (boundary.length) {
              context.beginPath();
              geoPath({ type: 'MultiLineString', coordinates: boundary });
              context.lineWidth = Math.max(0.5, Number(message.theme?.lakeBoundaryWidth) || 1);
              context.strokeStyle = featureColor;
              context.stroke();
            }
          }
          continue;
        }
        if (isBorder !== borderAligned) continue;
        const parts = lineParts(feature.geometry);
        const profiles = properties.stroke_widths || [];
        const fallback = Math.max(0.55, Math.min(2.6, Number(properties.stroke_width || 0.8)));
        context.globalAlpha = hydroOpacity;
        context.strokeStyle = featureColor;
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          const widths = profiles[partIndex] || [];
          for (let index = 0; index < part.length - 1; index += 1) {
            context.beginPath();
            geoPath({ type: 'LineString', coordinates: [part[index], part[index + 1]] });
            const start = Number(widths[index] ?? fallback);
            const end = Number(widths[index + 1] ?? start);
            context.lineWidth = (start + end) / 2 * Math.max(0.5, Number(message.theme?.riverWidth) || 1);
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
          if (self.d3.geo.contains(feature, coordinate)) return Number(properties.__fid);
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
          if (hydroActivePackIds.has(Number(message.packId))) scheduleHydroRender();
        }
        else if (message.type === 'active') {
          hydroActivePackIds = new Set((message.packIds || []).map(Number));
          scheduleHydroRender();
        } else if (message.type === 'release') {
          for (const packId of message.packIds || []) hydroPacks.delete(Number(packId));
        }
      };
      hydroPort.start?.();
    }

    function countryId(feature, index) {
      return String(feature?.id || index);
    }

    function countryOutlineFeature(feature) {
      const geometry = feature?.geometry;
      if (geometry && countryOutlineCache.has(geometry)) return countryOutlineCache.get(geometry);
      const lines = self.PandoLabGeographicBoundary.buildRenderableBoundarySegments(feature);
      const outline = { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: lines }, properties: feature?.properties || {} };
      if (geometry) countryOutlineCache.set(geometry, outline);
      return outline;
    }
    function render(message) {
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
        terrainComplete = renderTerrain(message, projection, width, height, dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        const geoPath = self.d3.geo.path().projection(projection).context(context);
        const hiddenCountryIds = new Set((message.hiddenCountryIds || []).map(String));
        const theme = message.theme || {};
        const defaultLand = theme.defaultLand || '#63758a';
        const fillAlpha = Number.isFinite(theme.fillAlpha) ? theme.fillAlpha : 0.74;
        const border = theme.border || '#323c46';
        const borderAlpha = Number.isFinite(theme.borderAlpha) ? theme.borderAlpha : 0.92;
        context.lineJoin = 'round';
        context.lineWidth = 0.72 * Math.max(0.5, Number(theme.borderWidth) || 1);
        for (let index = 0; message.visible && index < features.length; index += 1) {
          const feature = features[index];
          if (hiddenCountryIds.has(countryId(feature, index))) continue;
          context.beginPath();
          geoPath(feature);
          context.globalAlpha = fillAlpha;
          context.fillStyle = message.colors?.[countryId(feature, index)] || defaultLand;
          context.fill();
        }
        const emphasis = message.countryEmphasis || {};
        const selectedCountryIds = new Set((emphasis.selectedIds || []).map(String));
        for (let index = 0; message.visible && index < features.length; index += 1) {
          const feature = features[index];
          const id = countryId(feature, index);
          if (hiddenCountryIds.has(id)) continue;
          const kind = id === String(emphasis.primaryId || '') ? 'primary'
            : selectedCountryIds.has(id) ? 'secondary'
              : id === String(emphasis.hoverId || '') ? 'hover' : '';
          if (!kind) continue;
          context.beginPath();
          geoPath(feature);
          context.globalAlpha = Number(emphasis[`${kind}Alpha`] || 0);
          context.fillStyle = emphasis[`${kind}Color`] || defaultLand;
          context.fill();
        }
        renderHydroPass(message, projection, dpr, false);
        renderHydroPass(message, projection, dpr, true);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (let index = 0; message.visible && index < features.length; index += 1) {
          const feature = features[index];
          const id = countryId(feature, index);
          if (hiddenCountryIds.has(id)) continue;
          context.beginPath();
          geoPath(countryOutlineFeature(feature));
          context.globalAlpha = borderAlpha;
          context.strokeStyle = border;
          context.stroke();
        }
        context.globalAlpha = 1;
      }
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({
        type: 'frame',
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
      }, [bitmap]);
    }
    self.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'init') {
        features = message.features || [];
        geometryRevision = Number(message.geometryRevision || 0);
        viewRevision = Number(message.viewRevision || message.revision || 0);
        styleRevision = Number(message.styleRevision || 0);
        physicalStyleRevision = Number(message.physicalStyleRevision || 0);
        mergeRenderState(message);
        terrainFetchConcurrency = Math.max(1, Math.min(4, Number(message.terrainFetchConcurrency || 2)));
        loadTerrainManifest(message.terrainManifestUrl);
        self.postMessage({ type: 'ready' });
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
        self.postMessage({ type: 'hydro-pick', requestId: message.requestId, fid: pickHydroFeature(message.point) });
      } else if (message.type === 'data' || message.type === 'replace-data') {
        const incomingGeometryRevision = Number(message.geometryRevision || 0);
        if (incomingGeometryRevision < geometryRevision) {
          self.postMessage({
            type: 'data-ready', revision: Number(message.revision || 0), geometryRevision,
            taskToken: Number(message.taskToken || 0), ids: message.ids || [],
            replaceAll: true, stale: true,
          });
          return;
        }
        features = message.features || [];
        geometryRevision = incomingGeometryRevision;
        self.postMessage({
          type: 'data-ready',
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
            type: 'data-ready', revision: Number(message.revision || 0), geometryRevision,
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
            return [updates.get(id)];
          }
          return [feature];
        });
        for (const [id, feature] of updates) if (!seen.has(id)) features.push(feature);
        geometryRevision = incomingGeometryRevision;
        self.postMessage({
          type: 'data-ready',
          revision: Number(message.revision || 0),
          geometryRevision,
          taskToken: Number(message.taskToken || 0),
          ids: message.ids || [],
          replaceAll: false,
        });
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
          if (incomingRevision < viewRevision) return;
          viewRevision = incomingRevision;
          pumpTerrainFetchQueue();
          render(mergeRenderState(message));
        } catch (error) {
          self.postMessage({ type: 'error', message: error?.message || String(error) });
        }
      }
    };
  }

canvasFallbackWorkerMain();
