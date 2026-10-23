'use strict';

((scope) => {
  const MAX_RENDER_EDGE_DEGREES = 0.499;
  const MESH_ALGORITHM_REVISION = 5;
  const DEG_TO_RAD = Math.PI / 180;
  const PARAM_EPSILON = 1e-12;
  const AREA_EPSILON = 1e-20;
  const COUNTRY_BOUNDS_FLAG_DATELINE = 1;
  const COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE = 2;

  function isArtificialPolarClosureEdge(a, b) {
    if (scope.PandoLabGeographicBoundary?.isArtificialBoundaryEdge) {
      return scope.PandoLabGeographicBoundary.isArtificialBoundaryEdge(a, b);
    }
    if (!a || !b) return true;
    const atPole = point => Math.abs(Math.abs(Number(point[1])) - 90) <= 1e-7;
    const atSeam = point => Math.abs(Math.abs(normalizeLongitude(Number(point[0]))) - 180) <= 1e-7;
    return atPole(a) || atPole(b) || (atSeam(a) && atSeam(b));
  }

  function polygonsFor(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function normalizeLongitude(value) {
    let longitude = Number(value || 0);
    while (longitude > 180) longitude -= 360;
    while (longitude < -180) longitude += 360;
    return longitude;
  }

  function collectGeometryCoordinates(value, output) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && !Array.isArray(value[0]) && !Array.isArray(value[1]) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      output(normalizeLongitude(Number(value[0])), Math.max(-90, Math.min(90, Number(value[1]))));
      return;
    }
    for (const item of value) collectGeometryCoordinates(item, output);
  }

  function countryGeographicBounds(geometry) {
    const angles = [];
    let south = Infinity, north = -Infinity;
    collectGeometryCoordinates(geometry?.coordinates, (longitude, latitude) => {
      south = Math.min(south, latitude); north = Math.max(north, latitude);
      angles.push(((longitude + 180) % 360 + 360) % 360);
    });
    if (!angles.length) {
      return { bounds: [-180, -90, 180, 90], flags: COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE };
    }
    angles.sort((left, right) => left - right);
    let largestGap = -1;
    let gapIndex = 0;
    for (let index = 0; index < angles.length; index += 1) {
      const next = index + 1 < angles.length ? angles[index + 1] : angles[0] + 360;
      const gap = next - angles[index];
      if (gap > largestGap) {
        largestGap = gap;
        gapIndex = index;
      }
    }
    const longitudeSpan = Math.max(0, Math.min(360, 360 - largestGap));
    const westAngle = angles[(gapIndex + 1) % angles.length];
    const eastAngle = angles[gapIndex];
    const west = normalizeLongitude(westAngle - 180);
    const east = normalizeLongitude(eastAngle - 180);
    const crossesDateline = longitudeSpan > PARAM_EPSILON && west > east;
    const fullLongitude = longitudeSpan >= 300;
    return {
      bounds: [west, south, east, north],
      flags: (crossesDateline ? COUNTRY_BOUNDS_FLAG_DATELINE : 0)
        | (fullLongitude ? COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE : 0),
    };
  }

  function unitVector(point) {
    const longitude = point[0] * DEG_TO_RAD;
    const latitude = point[1] * DEG_TO_RAD;
    const cosine = Math.cos(latitude);
    return [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
  }

  function angularDistanceDegrees(a, b) {
    const va = unitVector(a);
    const vb = unitVector(b);
    const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    return Math.acos(dot) / DEG_TO_RAD;
  }

  function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  function signedArea(a, b, c) {
    return ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }

  // Projection here is used only by the packed-coordinate degeneracy guard.
  // Source projection, triangulation and conforming subdivision live in C++.
  function packingParameterSpace(pole) {
    return { kind: pole ? 'polar-azimuthal' : 'unwrapped-lonlat',
      project(point) {
        if (!pole) return point;
        const radius = pole > 0 ? 90 - point[1] : 90 + point[1];
        const longitude = point[0] * DEG_TO_RAD;
        return [radius * Math.cos(longitude), radius * Math.sin(longitude)];
      } };
  }

  let sharedCore = null;
  function setSharedCore(core) {
    if (typeof core?.polygonBuildFillMesh !== 'function'
      || core.polygonMeshAlgorithmRevision !== MESH_ALGORITHM_REVISION) {
      throw Object.assign(new Error('Compiled polygon fill mesh capability is unavailable.'),
        { code: 'PL-CORE-WASM-CAPABILITY' });
    }
    sharedCore = core;
  }
  function requireSharedCore() {
    if (!sharedCore) setSharedCore(scope.PandoLabSphericalCore);
    return sharedCore;
  }

  function unwrapTriangleLongitudes(points, triangles) {
    const output = [];
    const cloneCache = new Map();
    for (let index = 0; index < triangles.length; index += 3) {
      const indices = [triangles[index], triangles[index + 1], triangles[index + 2]];
      const longitudes = indices.map(pointIndex => points[pointIndex][0]);
      for (let pointIndex = 1; pointIndex < longitudes.length; pointIndex += 1) {
        while (longitudes[pointIndex] - longitudes[0] > 180) longitudes[pointIndex] -= 360;
        while (longitudes[pointIndex] - longitudes[0] < -180) longitudes[pointIndex] += 360;
      }
      for (let pointIndex = 0; pointIndex < indices.length; pointIndex += 1) {
        const sourceIndex = indices[pointIndex];
        const sourceLongitude = points[sourceIndex][0];
        const wrap = Math.round((longitudes[pointIndex] - sourceLongitude) / 360);
        if (!wrap) {
          output.push(sourceIndex);
          continue;
        }
        const key = `${sourceIndex}:${wrap}`;
        let cloneIndex = cloneCache.get(key);
        if (cloneIndex === undefined) {
          cloneIndex = points.length;
          points.push([sourceLongitude + wrap * 360, points[sourceIndex][1]]);
          cloneCache.set(key, cloneIndex);
        }
        output.push(cloneIndex);
      }
    }
    return output;
  }

  function removePackedDegenerateTriangles(points, triangles, parameterSpace) {
    const output = [];
    const removedTriangles = [];
    let removed = 0;
    const triangleKeys = new Set();
    for (let index = 0; index < triangles.length; index += 3) {
      const indices = [triangles[index], triangles[index + 1], triangles[index + 2]];
      const sourceParameter = indices.map(pointIndex => parameterSpace.project(points[pointIndex]));
      const packedInteger = indices.map(pointIndex => [
        Math.round(points[pointIndex][0] * 1e6),
        Math.round(points[pointIndex][1] * 1e6),
      ]);
      const packedKeys = packedInteger.map(point => `${point[0]},${point[1]}`);
      if (new Set(packedKeys).size < 3) {
        removed += 1;
        removedTriangles.push(indices);
        continue;
      }
      const sourceArea = signedArea(sourceParameter[0], sourceParameter[1], sourceParameter[2]);
      let packedArea;
      if (parameterSpace.kind === 'unwrapped-lonlat') {
        packedArea = signedArea(packedInteger[0], packedInteger[1], packedInteger[2]);
      } else {
        const packedParameter = packedInteger.map(point => parameterSpace.project([point[0] * 1e-6, point[1] * 1e-6]));
        packedArea = signedArea(packedParameter[0], packedParameter[1], packedParameter[2]);
      }
      const packedAreaIsZero = parameterSpace.kind === 'unwrapped-lonlat'
        ? packedArea === 0
        : Math.abs(packedArea) <= AREA_EPSILON;
      if (packedAreaIsZero || sourceArea * packedArea <= 0) {
        removed += 1;
        removedTriangles.push(indices);
        continue;
      }
      const triangleKey = indices.slice().sort((a, b) => a - b).join(':');
      if (triangleKeys.has(triangleKey)) {
        removed += 1;
        removedTriangles.push(indices);
        continue;
      }
      triangleKeys.add(triangleKey);
      output.push(...indices);
    }
    return { triangles: output, removed, removedTriangles };
  }

  function finalTriangleBoundaryEdges(points, triangles, chains, removedTriangles) {
    // Source rings decide which coast/seam edges exist. Final fill triangles
    // decide which vertices may actually represent those visible edges.
    const MICRO = 1e6, WORLD = 360 * MICRO, HALF = 180 * MICRO;
    const packed = points.map(point => [Math.round(point[0] * MICRO), Math.round(point[1] * MICRO)]);
    const normalized = packed.map(([longitude, latitude]) =>
      `${((longitude + HALF) % WORLD + WORLD) % WORLD - HALF},${latitude}`);
    const key = (a, b) => normalized[a] < normalized[b]
      ? `${normalized[a]}|${normalized[b]}` : `${normalized[b]}|${normalized[a]}`;

    const sources = new Map(), hidden = new Set();
    const candidates = new Map();
    for (const chain of chains) {
      for (let index = 0; index < chain.vertices.length; index += 1) {
        const a = chain.vertices[index], b = chain.vertices[(index + 1) % chain.vertices.length];
        if (packed[a][0] === packed[b][0] && packed[a][1] === packed[b][1]) continue;
        const pair = key(a, b);
        if (!chain.visible[index]) { hidden.add(pair); continue; }
        // Quantization can collapse a narrow polygon into a retraced path.
        // Cancel paired edges just as the discarded-triangle perimeter does.
        if (sources.has(pair)) sources.delete(pair);
        else sources.set(pair, { a, b, pair });
        if (!candidates.has(pair)) candidates.set(pair, new Map());
      }
    }
    if (!sources.size) return [];

    // A packed sliver can flip or collapse and be discarded. Its source
    // boundary must move to the exposed retained triangle edges, rather
    // than drawing the old ring through a part of the fill that no longer
    // exists. Use triangle connectivity, never a coordinate tolerance.
    const discardedByEdge = new Map();
    const triangleEdges = ([a, b, c]) => [[a, b], [b, c], [c, a]];
    removedTriangles.forEach((triangle, index) => {
      for (const [a, b] of triangleEdges(triangle)) {
        const pair = key(a, b);
        if (!discardedByEdge.has(pair)) discardedByEdge.set(pair, []);
        discardedByEdge.get(pair).push(index);
        if (!candidates.has(pair)) candidates.set(pair, new Map());
      }
    });

    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i], b = triangles[i + 1], c = triangles[i + 2];
      for (const [left, right] of [[a, b], [b, c], [c, a]]) {
        const pair = key(left, right);
        const matches = candidates.get(pair);
        if (!matches) continue;
        const triangleEdge = edgeKey(left, right);
        const previous = matches.get(triangleEdge);
        if (previous) previous.count++;
        else matches.set(triangleEdge, { a: left, b: right, count: 1 });
      }
    }

    const isRetainedBoundary = pair => [...candidates.get(pair).values()].some(edge => edge.count === 1);
    const visited = new Set();
    for (const { pair } of [...sources.values()]) {
      if (isRetainedBoundary(pair)) continue;
      const queue = [...(discardedByEdge.get(pair) || [])];
      const perimeter = new Map();
      for (let index = 0; index < queue.length; index++) {
        const triangleIndex = queue[index];
        if (visited.has(triangleIndex)) continue;
        visited.add(triangleIndex);
        for (const [a, b] of triangleEdges(removedTriangles[triangleIndex])) {
          const edge = key(a, b);
          if (perimeter.has(edge)) perimeter.delete(edge);
          else perimeter.set(edge, { a, b, pair: edge });
          for (const neighbor of discardedByEdge.get(edge)) if (!visited.has(neighbor)) queue.push(neighbor);
        }
      }
      for (const [edge, source] of perimeter) {
        if (sources.has(edge)) sources.delete(edge);
        else if (normalized[source.a] !== normalized[source.b]
          && !hidden.has(edge) && !isArtificialPolarClosureEdge(points[source.a], points[source.b]))
          sources.set(edge, source);
      }
    }

    return [...sources.values()].map(({ a, b, pair }) => {
      const boundary = [...candidates.get(pair).values()].filter(edge => edge.count === 1);
      if (!boundary.length) {
        throw Object.assign(new Error(`GPU 외곽선과 채색 경계 불일치: ${points[a].join(',')} → ${points[b].join(',')}`),
          { code: 'PL-MESH-BOUNDARY' });
      }
      let chosen = null, bestDistance = Infinity;
      for (const edge of boundary) {
        const forward = normalized[edge.a] === normalized[a];
        const start = forward ? edge.a : edge.b, end = forward ? edge.b : edge.a;
        const distance = Math.abs(packed[a][0] - packed[start][0])
          + Math.abs(packed[a][1] - packed[start][1])
          + Math.abs(packed[b][0] - packed[end][0])
          + Math.abs(packed[b][1] - packed[end][1]);
        if (distance < bestDistance) { bestDistance = distance; chosen = [start, end]; }
      }
      return chosen;
    });
  }

  function buildGpuMeshFeatures(features, options = {}) {
    const core = requireSharedCore();
    const validate = !!options.validate;
    const maxEdgeDegrees = Number.isFinite(Number(options.maxEdgeDegrees))
      ? Math.max(MAX_RENDER_EDGE_DEGREES, Number(options.maxEdgeDegrees))
      : MAX_RENDER_EDGE_DEGREES;
    const positions = [];
    const countryIndices = [];
    const triangleIndices = [];
    const lineIndices = [];
    const strokeStartsEnds = [];
    const strokeOwnerRanges = {};
    const countryTriangleRanges = [];
    const countryBoundaryRanges = [];
    const countryBounds = [];
    const countryBoundsFlags = [];
    const countryIds = [];
    const stats = {
      algorithmRevision: MESH_ALGORITHM_REVISION,
      polygonCount: 0,
      polarPolygonCount: 0,
      maxEdgeDegrees: 0,
      removedDegenerateTriangleCount: 0,
    };

    for (let countryIndex = 0; countryIndex < features.length; countryIndex += 1) {
      const feature = features[countryIndex];
      const countryId = String(feature?.id || countryIndex);
      countryIds.push(countryId);
      const countryTriangleStart = triangleIndices.length;
      const countryBoundaryStart = lineIndices.length;
      const countryStrokeStart = strokeStartsEnds.length / 4;
      for (const polygon of polygonsFor(feature.geometry)) {
        if (!polygon?.length) continue;
        options.throwIfCancelled?.();
        let refined;
        try { refined = core.polygonBuildFillMesh(polygon, maxEdgeDegrees, validate, options.throwIfCancelled); }
        catch (cause) {
          if (cause.code !== 'PL-MESH-TRIANGULATION') throw cause;
          throw Object.assign(new Error(`GPU 삼각분할 실패 (${countryId}): ${cause.message}`, { cause }),
            { code: 'PL-MESH-TRIANGULATION' });
        }
        const geoPoints = refined.geographic;
        const parameterSpace = packingParameterSpace(refined.pole);
        const boundaryChains = refined.boundaryChains;
        const removedTriangles = refined.removedTriangles;
        let localTriangles = refined.triangles;
        localTriangles = unwrapTriangleLongitudes(geoPoints, localTriangles);
        const packedTriangles = removePackedDegenerateTriangles(geoPoints, localTriangles, parameterSpace);
        localTriangles = packedTriangles.triangles;
        stats.removedDegenerateTriangleCount += packedTriangles.removed;

        const vertexOffset = positions.length / 2;
        for (const point of geoPoints) {
          positions.push(Math.round(point[0] * 1e6), Math.round(point[1] * 1e6));
          countryIndices.push(countryIndex);
        }
        for (const index of localTriangles) triangleIndices.push(vertexOffset + index);
        // Longitude unwrap can duplicate a vertex for a fill triangle
        // without updating the original boundary chain. Reconcile display
        // strokes with the FINAL packed triangle boundary after those clones
        // and discarded degenerate triangles have been decided.
        for (const [a, b] of finalTriangleBoundaryEdges(geoPoints, localTriangles, boundaryChains,
          removedTriangles.concat(packedTriangles.removedTriangles))) {
          const start = vertexOffset + a, end = vertexOffset + b;
          const ax = positions[start * 2], ay = positions[start * 2 + 1];
          const bx = positions[end * 2], by = positions[end * 2 + 1];
          lineIndices.push(start, end);
          strokeStartsEnds.push(ax * 1e-6, ay * 1e-6, bx * 1e-6, by * 1e-6);
        }

        for (let index = 0; index < localTriangles.length; index += 3) {
          const a = geoPoints[localTriangles[index]];
          const b = geoPoints[localTriangles[index + 1]];
          const c = geoPoints[localTriangles[index + 2]];
          stats.maxEdgeDegrees = Math.max(
            stats.maxEdgeDegrees,
            angularDistanceDegrees(a, b),
            angularDistanceDegrees(b, c),
            angularDistanceDegrees(c, a),
          );
        }
        stats.polygonCount += 1;
        if (parameterSpace.kind !== 'unwrapped-lonlat') stats.polarPolygonCount += 1;
      }
      strokeOwnerRanges[countryId] = Object.freeze({
        first: countryStrokeStart,
        count: strokeStartsEnds.length / 4 - countryStrokeStart,
      });
      countryTriangleRanges.push(countryTriangleStart, triangleIndices.length - countryTriangleStart);
      countryBoundaryRanges.push(countryBoundaryStart, lineIndices.length - countryBoundaryStart);
      const geographicBounds = countryGeographicBounds(feature?.geometry);
      countryBounds.push(...geographicBounds.bounds.map(value => Math.round(value * 1e6)));
      countryBoundsFlags.push(geographicBounds.flags);
    }

    if (stats.maxEdgeDegrees > maxEdgeDegrees + 1e-9) {
      throw new Error(`GPU 메시 최대 구면 변 길이 초과: ${stats.maxEdgeDegrees.toFixed(6)}°`);
    }

    return {
      countryIds,
      positions: new Int32Array(positions),
      countryIndices: new Uint16Array(countryIndices),
      triangleIndices: new Uint32Array(triangleIndices),
      lineIndices: new Uint32Array(lineIndices),
      strokeStartsEnds: new Float32Array(strokeStartsEnds),
      strokeOwnerRanges: Object.freeze(strokeOwnerRanges),
      countryTriangleRanges: new Uint32Array(countryTriangleRanges),
      countryBoundaryRanges: new Uint32Array(countryBoundaryRanges),
      countryBounds: new Int32Array(countryBounds),
      countryBoundsFlags: new Uint32Array(countryBoundsFlags),
      stats,
    };
  }

  function buildPolygonGeometryPacket(geometry, options = {}) {
    const mesh = buildGpuMeshFeatures([{ id: options.ownerId || 'overlay', geometry }],
      { validate: true, maxEdgeDegrees: MAX_RENDER_EDGE_DEGREES, throwIfCancelled: options.throwIfCancelled });
    if (!mesh.triangleIndices.length) throw Object.assign(new Error('GPU 삼각분할 실패: empty polygon'), { code: 'PL-MESH-TRIANGULATION' });
    const ringCoordinates = [], ringOffsets = [0], polygonOffsets = [0];
    for (const polygon of polygonsFor(geometry)) {
      for (const ring of polygon) {
        for (const point of ring) ringCoordinates.push(Number(point[0]), Number(point[1]));
        ringOffsets.push(ringCoordinates.length / 2);
      }
      polygonOffsets.push(ringOffsets.length - 1);
    }
    const displayPositions = Float32Array.from(mesh.positions, value => value * 1e-6);
    const boundaryIndices = [], startsEnds = [];
    for (let index = 0; index < mesh.lineIndices.length; index += 2) {
      const a = mesh.lineIndices[index], b = mesh.lineIndices[index + 1];
      const ax = displayPositions[a * 2], ay = displayPositions[a * 2 + 1];
      const bx = displayPositions[b * 2], by = displayPositions[b * 2 + 1];
      // Distinct packed integer vertices can become identical in Float32.
      // Enforce the existing nonzero display-edge contract after that conversion;
      // source rings and the shared C++ fill triangulation remain unchanged.
      if (ax === bx && ay === by) continue;
      boundaryIndices.push(a, b); startsEnds.push(ax, ay, bx, by);
    }
    return Object.freeze({ positions: displayPositions,
      indices: mesh.triangleIndices, boundaryIndices: new Uint32Array(boundaryIndices),
      startsEnds: new Float32Array(startsEnds), segmentCount: boundaryIndices.length / 2,
      featureIds: Uint32Array.from(mesh.countryIndices),
      vertexCount: mesh.positions.length / 2, triangleCount: mesh.triangleIndices.length / 3,
      ringCoordinates: new Float64Array(ringCoordinates), ringOffsets: new Uint32Array(ringOffsets),
      polygonOffsets: new Uint32Array(polygonOffsets), algorithmVersion: MESH_ALGORITHM_REVISION,
      maxEdgeDegrees: mesh.stats.maxEdgeDegrees });
  }

  const api = {
    setSharedCore,
    MAX_RENDER_EDGE_DEGREES,
    MESH_ALGORITHM_REVISION,
    COUNTRY_BOUNDS_FLAG_DATELINE,
    COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE,
    isArtificialPolarClosureEdge,
    countryGeographicBounds,
    buildGpuMeshFeatures,
    buildPolygonGeometryPacket,
  };
  scope.PandoLabGpuMeshCore = api;
  if (typeof module === 'object' && module?.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
