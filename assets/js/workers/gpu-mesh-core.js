'use strict';

((scope) => {
  const MAX_RENDER_EDGE_DEGREES = 0.499;
  const MAX_REFINEMENT_PASSES = 40;
  const MESH_ALGORITHM_REVISION = 4;
  const DEG_TO_RAD = Math.PI / 180;
  const PARAM_EPSILON = 1e-12;
  const AREA_EPSILON = 1e-20;
  const COUNTRY_BOUNDS_FLAG_DATELINE = 1;
  const COUNTRY_BOUNDS_FLAG_FULL_LONGITUDE = 2;

  function samePoint(a, b, epsilon = PARAM_EPSILON) {
    return a && b && Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
  }

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

  function unwrapLongitudeNear(longitude, reference) {
    let value = normalizeLongitude(longitude);
    while (value - reference > 180) value -= 360;
    while (value - reference < -180) value += 360;
    return value;
  }

  function unwrapRing(rawRing, anchor = null) {
    let ring = rawRing || [];
    if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring = ring.slice(0, -1);
    if (ring.length < 3) return [];
    const firstLongitude = anchor === null
      ? Number(ring[0][0])
      : unwrapLongitudeNear(Number(ring[0][0]), anchor);
    const output = [[firstLongitude, Number(ring[0][1])]];
    for (let index = 1; index < ring.length; index += 1) {
      output.push([
        unwrapLongitudeNear(Number(ring[index][0]), output[index - 1][0]),
        Number(ring[index][1]),
      ]);
    }
    return output;
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

  function triangleAreaSum(points, triangles) {
    let area = 0;
    for (let index = 0; index < triangles.length; index += 3) {
      area += Math.abs(signedArea(points[triangles[index]], points[triangles[index + 1]], points[triangles[index + 2]]));
    }
    return area;
  }

  function ringArea(points) {
    const origin = points[0];
    let sum = 0;
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length];
      sum += (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1]);
    }
    return Math.abs(sum / 2);
  }

  function checkedTriangulation(points, rings, indices, owner) {
    const expected = ringArea(rings[0].parameter) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring.parameter), 0);
    const fail = message => { throw Object.assign(new Error(`GPU 삼각분할 실패 (${owner}): ${message}`), { code: 'PL-MESH-TRIANGULATION' }); };
    if (!indices?.length || indices.length % 3 || expected <= AREA_EPSILON) fail('빈 면 또는 퇴화된 원본');
    for (const index of indices) if (!Number.isInteger(index) || index < 0 || index >= points.length) fail('원본 정점 참조 범위');
    const actual = triangleAreaSum(points, indices);
    if (Math.abs(actual - expected) > Math.max(1e-9, expected * 1e-8)) fail(`구멍/외곽 면적 불일치 ${expected} → ${actual}`);
    return indices;
  }

  function makeParameterSpace(outerRing) {
    const longitudes = outerRing.map(point => point[0]);
    const latitudes = outerRing.map(point => point[1]);
    const longitudeSpan = Math.max(...longitudes) - Math.min(...longitudes);
    const minimumLatitude = Math.min(...latitudes);
    const maximumLatitude = Math.max(...latitudes);
    let pole = 0;
    if (longitudeSpan >= 300 && minimumLatitude <= -89.5) pole = -1;
    else if (longitudeSpan >= 300 && maximumLatitude >= 89.5) pole = 1;

    if (!pole) {
      return {
        kind: 'unwrapped-lonlat',
        project: point => [Number(point[0]), Number(point[1])],
        unproject: (point, longitudeAnchor) => [unwrapLongitudeNear(point[0], longitudeAnchor), Number(point[1])],
      };
    }

    return {
      kind: pole > 0 ? 'north-polar-azimuthal' : 'south-polar-azimuthal',
      project(point) {
        const longitude = Number(point[0]) * DEG_TO_RAD;
        const radius = pole > 0 ? 90 - Number(point[1]) : 90 + Number(point[1]);
        return [radius * Math.cos(longitude), radius * Math.sin(longitude)];
      },
      unproject(point, longitudeAnchor) {
        const radius = Math.hypot(point[0], point[1]);
        const latitude = pole > 0 ? 90 - radius : radius - 90;
        if (radius <= PARAM_EPSILON) return [Number(longitudeAnchor || 0), pole > 0 ? 90 : -90];
        const longitude = Math.atan2(point[1], point[0]) / DEG_TO_RAD;
        return [unwrapLongitudeNear(longitude, longitudeAnchor), Math.max(-90, Math.min(90, latitude))];
      },
    };
  }

  function prepareRing(rawRing, anchor, parameterSpace) {
    const geo = unwrapRing(rawRing, anchor);
    if (geo.length < 3) return null;
    const cleanGeo = [];
    const parameter = [];
    for (const point of geo) {
      const projected = parameterSpace.project(point);
      if (parameter.length && samePoint(parameter[parameter.length - 1], projected)) continue;
      cleanGeo.push(point);
      parameter.push(projected);
    }
    if (parameter.length > 1 && samePoint(parameter[0], parameter[parameter.length - 1])) {
      parameter.pop();
      cleanGeo.pop();
    }
    return cleanGeo.length >= 3 ? { geo: cleanGeo, parameter } : null;
  }

  function refineTriangles(geoPoints, parameterPoints, sourceTriangles, parameterSpace, validate, maxEdgeDegrees = MAX_RENDER_EDGE_DEGREES, boundaryChains = []) {
    const vectors = geoPoints.map(unitVector);
    const minimumEdgeDot = Math.cos(Math.max(0.01, Number(maxEdgeDegrees) - 0.000002) * DEG_TO_RAD);
    let triangles = [];
    for (let index = 0; index < sourceTriangles.length; index += 3) {
      const a = sourceTriangles[index];
      const b = sourceTriangles[index + 1];
      const c = sourceTriangles[index + 2];
      if (Math.abs(signedArea(parameterPoints[a], parameterPoints[b], parameterPoints[c])) <= AREA_EPSILON) continue;
      triangles.push(a, b, c);
    }
    const sourceArea = validate ? triangleAreaSum(parameterPoints, triangles) : 0;

    const edgeDot = (a, b) => {
      const va = vectors[a];
      const vb = vectors[b];
      return va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
    };
    const edgeNeedsSplit = (a, b) => edgeDot(a, b) < minimumEdgeDot - 1e-14;

    for (let pass = 0; pass < MAX_REFINEMENT_PASSES; pass += 1) {
      const splitEdges = new Map();
      const markEdge = (a, b) => {
        if (!edgeNeedsSplit(a, b)) return;
        const key = edgeKey(a, b);
        if (!splitEdges.has(key)) splitEdges.set(key, [a, b]);
      };
      for (let index = 0; index < triangles.length; index += 3) {
        const a = triangles[index];
        const b = triangles[index + 1];
        const c = triangles[index + 2];
        markEdge(a, b);
        markEdge(b, c);
        markEdge(c, a);
      }
      if (!splitEdges.size) {
        if (validate) {
          const refinedArea = triangleAreaSum(parameterPoints, triangles);
          const tolerance = Math.max(1e-10, sourceArea * 1e-10);
          if (Math.abs(refinedArea - sourceArea) > tolerance) {
            throw new Error(`GPU 면 세분화 면적 보존 실패: ${sourceArea} → ${refinedArea}`);
          }
        }
        return triangles;
      }

      const midpointIndices = new Map();
      for (const [key, edge] of splitEdges) {
        const aIndex = edge[0];
        const bIndex = edge[1];
        const aParameter = parameterPoints[aIndex];
        const bParameter = parameterPoints[bIndex];
        const parameterMidpoint = [
          (aParameter[0] + bParameter[0]) / 2,
          (aParameter[1] + bParameter[1]) / 2,
        ];
        const longitudeAnchor = (geoPoints[aIndex][0] + geoPoints[bIndex][0]) / 2;
        const geoMidpoint = parameterSpace.unproject(parameterMidpoint, longitudeAnchor);
        const midpointIndex = geoPoints.length;
        parameterPoints.push(parameterMidpoint);
        geoPoints.push(geoMidpoint);
        vectors.push(unitVector(geoMidpoint));
        midpointIndices.set(key, midpointIndex);
      }

      // Carry each boundary midpoint into the line mesh as triangle edges
      // split. Preserve visibility inherited from the original ring edge.
      for (const chain of boundaryChains) {
        const vertices = [];
        const visible = [];
        for (let index = 0; index < chain.vertices.length; index += 1) {
          const a = chain.vertices[index];
          const b = chain.vertices[(index + 1) % chain.vertices.length];
          const midpoint = midpointIndices.get(edgeKey(a, b));
          vertices.push(a);
          visible.push(chain.visible[index]);
          if (midpoint !== undefined) {
            vertices.push(midpoint);
            visible.push(chain.visible[index]);
          }
        }
        chain.vertices = vertices;
        chain.visible = visible;
      }

      const next = [];
      const add = (a, b, c) => {
        if (Math.abs(signedArea(parameterPoints[a], parameterPoints[b], parameterPoints[c])) > AREA_EPSILON) next.push(a, b, c);
      };
      for (let index = 0; index < triangles.length; index += 3) {
        const a = triangles[index];
        const b = triangles[index + 1];
        const c = triangles[index + 2];
        const ab = midpointIndices.get(edgeKey(a, b));
        const bc = midpointIndices.get(edgeKey(b, c));
        const ca = midpointIndices.get(edgeKey(c, a));
        const mask = (ab === undefined ? 0 : 1) | (bc === undefined ? 0 : 2) | (ca === undefined ? 0 : 4);
        if (mask === 0) add(a, b, c);
        else if (mask === 1) {
          add(a, ab, c); add(ab, b, c);
        } else if (mask === 2) {
          add(b, bc, a); add(bc, c, a);
        } else if (mask === 4) {
          add(c, ca, b); add(ca, a, b);
        } else if (mask === 3) {
          add(ab, b, bc);
          if (edgeDot(a, bc) >= edgeDot(ab, c)) {
            add(a, ab, bc); add(a, bc, c);
          } else {
            add(a, ab, c); add(ab, bc, c);
          }
        } else if (mask === 6) {
          add(bc, c, ca);
          if (edgeDot(b, ca) >= edgeDot(bc, a)) {
            add(b, bc, ca); add(b, ca, a);
          } else {
            add(b, bc, a); add(bc, ca, a);
          }
        } else if (mask === 5) {
          add(ca, a, ab);
          if (edgeDot(c, ab) >= edgeDot(ca, b)) {
            add(c, ca, ab); add(c, ab, b);
          } else {
            add(c, ca, b); add(ca, ab, b);
          }
        } else {
          add(a, ab, ca); add(ab, b, bc); add(ca, bc, c); add(ab, bc, ca);
        }
      }
      triangles = next;
    }

    let worst = null;
    for (let index = 0; index < triangles.length; index += 3) {
      for (const edge of [
        [triangles[index], triangles[index + 1]],
        [triangles[index + 1], triangles[index + 2]],
        [triangles[index + 2], triangles[index]],
      ]) {
        if (!edgeNeedsSplit(edge[0], edge[1])) continue;
        const degrees = angularDistanceDegrees(geoPoints[edge[0]], geoPoints[edge[1]]);
        if (!worst || degrees > worst.degrees) worst = { degrees, a: geoPoints[edge[0]], b: geoPoints[edge[1]] };
      }
    }
    if (worst) {
      throw new Error(`GPU 면 세분화가 수렴하지 않았습니다: ${worst.degrees.toFixed(6)}° ${worst.a.join(',')} → ${worst.b.join(',')}`);
    }
    return triangles;
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
        sources.set(pair, { a, b, pair });
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
        else if (!hidden.has(edge) && !isArtificialPolarClosureEdge(points[source.a], points[source.b]))
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

  function buildGpuMeshFeatures(features, earcutImpl, options = {}) {
    if (typeof earcutImpl !== 'function') throw new Error('GPU 삼각분할 엔진이 없습니다.');
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
        const outer = unwrapRing(polygon[0]);
        if (outer.length < 3) continue;
        const anchor = outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
        const parameterSpace = makeParameterSpace(outer);
        const rings = [];
        const outerRing = prepareRing(polygon[0], null, parameterSpace);
        if (!outerRing) throw Object.assign(new Error(`GPU 삼각분할 실패: ${countryId} shell`), { code: 'PL-MESH-TRIANGULATION' });
        rings.push(outerRing);
        for (let ringIndex = 1; ringIndex < polygon.length; ringIndex += 1) {
          const hole = prepareRing(polygon[ringIndex], anchor, parameterSpace);
          if (!hole) throw Object.assign(new Error(`GPU 삼각분할 실패: ${countryId} hole ${ringIndex}`), { code: 'PL-MESH-TRIANGULATION' });
          rings.push(hole);
        }

        const parameterFlat = [];
        const holes = [];
        const geoPoints = [];
        const parameterPoints = [];
        const ringStarts = [];
        const ringCounts = [];
        for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
          if (ringIndex > 0) holes.push(parameterFlat.length / 2);
          ringStarts.push(geoPoints.length);
          ringCounts.push(rings[ringIndex].geo.length);
          for (let pointIndex = 0; pointIndex < rings[ringIndex].geo.length; pointIndex += 1) {
            const geoPoint = rings[ringIndex].geo[pointIndex];
            const parameterPoint = rings[ringIndex].parameter[pointIndex];
            geoPoints.push([geoPoint[0], geoPoint[1]]);
            parameterPoints.push([parameterPoint[0], parameterPoint[1]]);
            parameterFlat.push(parameterPoint[0], parameterPoint[1]);
          }
        }

        // Keep the original artificial pole/seam edges hidden even when
        // their triangles gain new boundary vertices during refinement.
        const boundaryChains = ringStarts.map((start, ringIndex) => {
          const vertices = Array.from({ length: ringCounts[ringIndex] }, (_, index) => start + index);
          return { vertices, visible: vertices.map((a, index) =>
            !isArtificialPolarClosureEdge(geoPoints[a], geoPoints[vertices[(index + 1) % vertices.length]])) };
        });
        let localTriangles = refineTriangles(
          geoPoints,
          parameterPoints,
          checkedTriangulation(parameterPoints, rings, earcutImpl(parameterFlat, holes, 2), countryId),
          parameterSpace,
          validate,
          maxEdgeDegrees,
          boundaryChains,
        );
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
        for (const [a, b] of finalTriangleBoundaryEdges(geoPoints, localTriangles, boundaryChains, packedTriangles.removedTriangles)) {
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
    const mesh = buildGpuMeshFeatures([{ id: options.ownerId || 'overlay', geometry }], options.triangulate || scope.earcut,
      { validate: true, maxEdgeDegrees: MAX_RENDER_EDGE_DEGREES });
    if (!mesh.triangleIndices.length) throw Object.assign(new Error('GPU 삼각분할 실패: empty polygon'), { code: 'PL-MESH-TRIANGULATION' });
    const ringCoordinates = [], ringOffsets = [0], polygonOffsets = [0];
    for (const polygon of polygonsFor(geometry)) {
      for (const ring of polygon) {
        for (const point of ring) ringCoordinates.push(Number(point[0]), Number(point[1]));
        ringOffsets.push(ringCoordinates.length / 2);
      }
      polygonOffsets.push(ringOffsets.length - 1);
    }
    return Object.freeze({ positions: Float32Array.from(mesh.positions, value => value * 1e-6),
      indices: mesh.triangleIndices, boundaryIndices: mesh.lineIndices,
      startsEnds: mesh.strokeStartsEnds, segmentCount: mesh.lineIndices.length / 2,
      featureIds: Uint32Array.from(mesh.countryIndices),
      vertexCount: mesh.positions.length / 2, triangleCount: mesh.triangleIndices.length / 3,
      ringCoordinates: new Float64Array(ringCoordinates), ringOffsets: new Uint32Array(ringOffsets),
      polygonOffsets: new Uint32Array(polygonOffsets), algorithmVersion: MESH_ALGORITHM_REVISION,
      maxEdgeDegrees: mesh.stats.maxEdgeDegrees });
  }

  const api = {
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
