/** CutGeometry: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCutGeometry() {
  let dependencies;

  function connect(ports) {
    if (dependencies) throw new Error('cut-geometry already connected');
    dependencies = ports;
  }

  function coordinateBounds(value, bounds = [Infinity, Infinity, -Infinity, -Infinity]) {
    if (!Array.isArray(value)) return bounds;
    if (value.length >= 2 && !Array.isArray(value[0]) && !Array.isArray(value[1])
      && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
      return bounds;
    }
    value.forEach(item => coordinateBounds(item, bounds));
    return bounds;
  }

  function boundsOverlap(a, b) {
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function normalizeClippedLandGeometry(multiPolygon) {
    return (0, dependencies.normalizeCountryGeometry)(multiPolygon);
  }

  function pointOnRingBoundary(point, rawRing, tolerance = 1e-7) {
    const ring = (0, dependencies.ensureClosedRing)(rawRing);
    for (let i = 0; i < ring.length - 1; i += 1) {
      if ((0, dependencies.pointOnSegment)(point, ring[i], ring[i + 1], tolerance)) return true;
    }
    return false;
  }

  function pointInPolygonSetInterior(point, polygon) {
    if (!polygon?.length || pointOnRingBoundary(point, polygon[0])) return false;
    if (!(0, dependencies.pointInRing)(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i += 1) {
      if (pointOnRingBoundary(point, polygon[i]) || (0, dependencies.pointInRing)(point, polygon[i])) return false;
    }
    return true;
  }

  function segmentsIntersectOrTouch(a, b, c, d, tolerance = 1e-9) {
    return (0, dependencies.segmentsProperlyIntersect)(a, b, c, d, tolerance) ||
      (0, dependencies.pointOnSegment)(a, c, d, tolerance) || (0, dependencies.pointOnSegment)(b, c, d, tolerance) ||
      (0, dependencies.pointOnSegment)(c, a, b, tolerance) || (0, dependencies.pointOnSegment)(d, a, b, tolerance);
  }

  function lineHasSelfIntersection(coords) {
    const segmentCount = Math.max(0, (coords?.length || 0) - 1);
    for (let i = 0; i < segmentCount; i += 1) {
      for (let j = i + 1; j < segmentCount; j += 1) {
        if (Math.abs(i - j) <= 1) continue;
        if (segmentsIntersectOrTouch(coords[i], coords[i + 1], coords[j], coords[j + 1])) return true;
      }
    }
    return false;
  }

  function unwrapLongitudeNear(longitude, reference) {
    let value = Number(longitude);
    while (value - reference > 180) value -= 360;
    while (value - reference < -180) value += 360;
    return value;
  }

  function segmentIntersectionDetail(a, b, c, d, epsilon = 1e-10) {
    const p = [Number(a[0]), Number(a[1])];
    const q = [unwrapLongitudeNear(c[0], p[0]), Number(c[1])];
    const bLon = unwrapLongitudeNear(b[0], p[0]);
    let dLon = unwrapLongitudeNear(d[0], q[0]);
    const lineMid = (p[0] + bLon) / 2;
    while ((q[0] + dLon) / 2 - lineMid > 180) { q[0] -= 360; dLon -= 360; }
    while ((q[0] + dLon) / 2 - lineMid < -180) { q[0] += 360; dLon += 360; }
    const r = [bLon - p[0], Number(b[1]) - p[1]];
    const s = [dLon - q[0], Number(d[1]) - q[1]];
    const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
    const qp = [q[0] - p[0], q[1] - p[1]];
    const denominator = cross(r, s);
    if (Math.abs(denominator) <= epsilon) {
      if (Math.abs(cross(qp, r)) > epsilon) return null;
      const length2 = r[0] * r[0] + r[1] * r[1];
      if (length2 <= epsilon) return null;
      const t0 = (qp[0] * r[0] + qp[1] * r[1]) / length2;
      const qd = [q[0] + s[0] - p[0], q[1] + s[1] - p[1]];
      const t1 = (qd[0] * r[0] + qd[1] * r[1]) / length2;
      const overlapStart = Math.max(0, Math.min(t0, t1));
      const overlapEnd = Math.min(1, Math.max(t0, t1));
      return overlapEnd - overlapStart > epsilon ? { overlap: true } : null;
    }
    const lineT = cross(qp, s) / denominator;
    const boundaryT = cross(qp, r) / denominator;
    if (lineT < -epsilon || lineT > 1 + epsilon || boundaryT < -epsilon || boundaryT > 1 + epsilon) return null;
    const t = (0, dependencies.clamp)(lineT, 0, 1);
    return {
      overlap: false,
      lineT: t,
      boundaryT: (0, dependencies.clamp)(boundaryT, 0, 1),
      coord: (0, dependencies.interpolateCoordinate)(a, b, t),
    };
  }

  function coordinateAtPathPosition(rawLine, position) {
    const maxPosition = Math.max(0, rawLine.length - 1);
    const bounded = (0, dependencies.clamp)(position, 0, maxPosition);
    if (bounded >= maxPosition) return rawLine[rawLine.length - 1].slice();
    const segmentIndex = Math.floor(bounded);
    return (0, dependencies.interpolateCoordinate)(rawLine[segmentIndex], rawLine[segmentIndex + 1], bounded - segmentIndex);
  }

  function interiorComponentIndex(point, polygons) {
    for (let index = 0; index < polygons.length; index += 1) {
      if (pointInPolygonSetInterior(point, polygons[index])) return index;
    }
    return null;
  }

  function activeCutDraftSourceGeometry() {
    if (dependencies.state.tool === 'split-generic-feature') {
      return dependencies.state.genericFeatures.find(item => String(item.id) === String(dependencies.state.genericFeatureSplitSourceId))?.geometry || null;
    }
    if (dependencies.state.tool === 'split-territorial-unit') {
      return ((0, dependencies.territorialUnitById)(dependencies.state.territorialUnitSplitSourceId) || dependencies.state.territorialUnitSplitVirtualSource)?.geometry || null;
    }
    const territorySelection = dependencies.state.territorySelectionSession;
    if (territorySelection?.tool === dependencies.state.tool && territorySelection.stage === 'selection'
      && territorySelection.activePhase === 'drawing' && territorySelection.activeMethod === 'line') return territorySelection.workingSourceGeometry || null;
    return null;
  }

  function cutEndpointSnapDistance() {
    const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches;
    return coarsePointer ? dependencies.CUT_ENDPOINT_SNAP_DISTANCE.touch : dependencies.CUT_ENDPOINT_SNAP_DISTANCE.mouse;
  }

  function snapCutDraftLine(rawLine, sourceGeometry) {
    return (0, dependencies.snapLineEndpointsToBoundary)(rawLine, sourceGeometry, {
      project: coordinate => (0, dependencies.activeProjection)()(coordinate),
      maxDistance: cutEndpointSnapDistance(),
      isVisible: dependencies.isCoordVisible,
      maxSegmentLength: Math.max(1, dependencies.state.size.width * 0.7),
    });
  }

  function cutDraftErrorMessage(line, sourceGeometry, originalError) {
    const fallback = String(originalError?.message || '경계선을 사용할 수 없습니다.');
    if (!Array.isArray(line) || line.length < 2) return '경계선을 만들려면 점을 두 개 이상 입력하세요.';
    const polygons = (0, dependencies.geometryPolygonSets)(sourceGeometry);
    if (!polygons.length) return fallback;
    let events;
    try { events = collectCutBoundaryEvents(line, polygons); }
    catch (_) { return fallback; }
    if (events.length > 2) return '경계를 여러 번 가로지릅니다. 한 번만 관통하세요.';
    const startInside = interiorComponentIndex(line[0], polygons) !== null;
    const endInside = interiorComponentIndex(line[line.length - 1], polygons) !== null;
    if (startInside && endInside) return '시작점과 끝점을 영역 밖에 놓으세요.';
    if (startInside) return '시작점을 영역 밖에 놓으세요.';
    if (endInside) return '끝점을 영역 밖에 놓으세요.';
    if (events.length === 0) return '영역을 통과하지 않습니다. 양쪽 경계를 가로지르세요.';
    if (events.length === 1) return '한쪽 경계만 연결됐습니다. 반대쪽 경계까지 그리세요.';
    return fallback;
  }

  function draftSelfIntersectionIssue(coords, closed = false) {
    const points = (coords || []).map(coord => coord.slice());
    if (closed && points.length >= 3) points.push(points[0].slice());
    const segmentCount = Math.max(0, points.length - 1);
    for (let left = 0; left < segmentCount; left += 1) {
      for (let right = left + 1; right < segmentCount; right += 1) {
        if (Math.abs(left - right) <= 1 || (closed && left === 0 && right === segmentCount - 1)) continue;
        const detail = segmentIntersectionDetail(points[left], points[left + 1], points[right], points[right + 1]);
        if (!detail) continue;
        return {
          kind: detail.overlap ? 'segment-overlap' : 'self-intersection',
          coordinate: detail.coord || (0, dependencies.interpolateCoordinate)(points[left], points[left + 1], 0.5),
          segmentIndex: left,
        };
      }
    }
    return null;
  }

  function cutDraftIssues(line, sourceGeometry, originalError) {
    if (!Array.isArray(line) || line.length < 2) return [];
    const message = cutDraftErrorMessage(line, sourceGeometry, originalError);
    const issues = [];
    for (let index = 1; index < line.length; index += 1) {
      if (!(0, dependencies.coordNear)(line[index - 1], line[index], 1e-9)) continue;
      issues.push({ kind: 'duplicate-vertex', coordinate: line[index].slice(), vertexIndex: index, segmentIndex: index - 1, message });
      return issues;
    }
    const selfIntersection = draftSelfIntersectionIssue(line, false);
    if (selfIntersection) {
      issues.push({ ...selfIntersection, message });
      return issues;
    }
    const polygons = (0, dependencies.geometryPolygonSets)(sourceGeometry);
    if (!polygons.length) return [{ kind: 'invalid-cut', coordinate: line[Math.floor((line.length - 1) / 2)].slice(), message }];
    const startInside = interiorComponentIndex(line[0], polygons) !== null;
    const endInside = interiorComponentIndex(line[line.length - 1], polygons) !== null;
    if (startInside) issues.push({ kind: 'endpoint-inside', coordinate: line[0].slice(), vertexIndex: 0, message });
    if (endInside) issues.push({ kind: 'endpoint-inside', coordinate: line[line.length - 1].slice(), vertexIndex: line.length - 1, message });
    if (issues.length) return issues;
    let events;
    try { events = collectCutBoundaryEvents(line, polygons); }
    catch (_) {
      return [{
        kind: 'boundary-overlap',
        coordinate: (0, dependencies.interpolateCoordinate)(line[0], line[1], 0.5),
        segmentIndex: 0,
        message,
      }];
    }
    if (events.length > 2) {
      return events.slice(2).map(event => ({
        kind: 'extra-boundary-crossing',
        coordinate: event.coord.slice(),
        segmentIndex: Math.min(line.length - 2, Math.max(0, Math.floor(event.position))),
        message,
      }));
    }
    if (events.length === 1) {
      const event = events[0];
      const distanceToStart = Math.abs(event.position);
      const distanceToEnd = Math.abs((line.length - 1) - event.position);
      const vertexIndex = distanceToStart > distanceToEnd ? 0 : line.length - 1;
      return [{ kind: 'missing-boundary-connection', coordinate: line[vertexIndex].slice(), vertexIndex, message }];
    }
    if (events.length === 2) {
      const middlePosition = (events[0].position + events[1].position) / 2;
      const middle = coordinateAtPathPosition(line, middlePosition);
      const componentIndex = interiorComponentIndex(middle, polygons);
      if (componentIndex !== null) {
        const component = polygons[componentIndex];
        for (let index = 1; index < line.length - 1; index += 1) {
          if (pointInPolygonSetInterior(line[index], component)) continue;
          return [{ kind: 'intermediate-outside', coordinate: line[index].slice(), vertexIndex: index, message }];
        }
        for (let index = 0; index < line.length - 1; index += 1) {
          const a = line[index], b = line[index + 1];
          const projectedA = (0, dependencies.activeProjection)()(a);
          const projectedB = (0, dependencies.activeProjection)()(b);
          const screenLength = projectedA && projectedB ? Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]) : 120;
          const samples = (0, dependencies.clamp)(Math.ceil(screenLength / 8), 12, 80);
          for (let sample = 1; sample < samples; sample += 1) {
            const coordinate = (0, dependencies.interpolateCoordinate)(a, b, sample / samples);
            if (pointInPolygonSetInterior(coordinate, component)) continue;
            return [{ kind: 'segment-outside', coordinate, segmentIndex: index, message }];
          }
        }
      }
    }
    const middleSegmentIndex = Math.max(0, Math.min(line.length - 2, Math.floor((line.length - 2) / 2)));
    return [{
      kind: events.length ? 'invalid-cut' : 'no-boundary-crossing',
      coordinate: (0, dependencies.interpolateCoordinate)(line[middleSegmentIndex], line[middleSegmentIndex + 1], 0.5),
      segmentIndex: middleSegmentIndex,
      message,
    }];
  }

  function prepareCutDraft(rawLine, sourceGeometry) {
    const snapped = snapCutDraftLine(rawLine, sourceGeometry);
    try {
      const extracted = extractSingleInteriorCut(snapped.line, sourceGeometry);
      validateAnnexCutLine(extracted.cutLine, extracted.component);
      return { ...snapped, extracted };
    } catch (error) {
      throw new Error(cutDraftErrorMessage(snapped.line, sourceGeometry, error), { cause: error });
    }
  }

  function assessCutDraft(rawLine, sourceGeometry) {
    const snapped = snapCutDraftLine(rawLine, sourceGeometry);
    if (snapped.line.length < 2) {
      return { ...snapped, status: 'pending', valid: false, message: '', issues: [] };
    }
    try {
      const extracted = extractSingleInteriorCut(snapped.line, sourceGeometry);
      validateAnnexCutLine(extracted.cutLine, extracted.component);
      return { ...snapped, extracted, status: 'valid', valid: true, message: '', issues: [] };
    } catch (error) {
      const message = cutDraftErrorMessage(snapped.line, sourceGeometry, error);
      return {
        ...snapped,
        status: 'invalid',
        valid: false,
        message,
        issues: cutDraftIssues(snapped.line, sourceGeometry, error),
      };
    }
  }

  function collectCutBoundaryEvents(rawLine, polygons) {
    const events = [];
    for (let lineIndex = 0; lineIndex < rawLine.length - 1; lineIndex += 1) {
      const a = rawLine[lineIndex], b = rawLine[lineIndex + 1];
      if ((0, dependencies.coordNear)(a, b, 1e-10)) continue;
      polygons.forEach((polygon, polygonIndex) => {
        polygon.forEach((rawRing, ringIndex) => {
          const ring = (0, dependencies.ensureClosedRing)(rawRing);
          for (let boundarySegmentIndex = 0; boundarySegmentIndex < ring.length - 1; boundarySegmentIndex += 1) {
            const detail = segmentIntersectionDetail(a, b, ring[boundarySegmentIndex], ring[boundarySegmentIndex + 1]);
            if (!detail) continue;
            if (detail.overlap) throw new Error('국경선을 기존 경계와 겹쳐 그릴 수 없습니다.');
            events.push({
              position: lineIndex + detail.lineT,
              coord: detail.coord,
              ref: { polygonIndex, ringIndex, boundarySegmentIndex, boundaryT: detail.boundaryT },
            });
          }
        });
      });
    }
    events.sort((a, b) => a.position - b.position);
    const unique = [];
    for (const event of events) {
      const previous = unique[unique.length - 1];
      if (previous && Math.abs(previous.position - event.position) <= 1e-7 && (0, dependencies.coordNear)(previous.coord, event.coord, 1e-7)) {
        previous.refs.push(event.ref);
      } else {
        unique.push({ position: event.position, coord: event.coord.slice(), refs: [event.ref] });
      }
    }
    return unique;
  }

  function extractSingleInteriorCut(rawLine, sourceGeometry) {
    const line = (rawLine || []).map(coord => [Number(coord[0]), Number(coord[1])]);
    if (line.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const polygons = (0, dependencies.geometryPolygonSets)(sourceGeometry);
    if (!polygons.length) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const events = collectCutBoundaryEvents(line, polygons);
    if (events.length !== 2) {
      throw new Error('국경선은 선택 영토의 한 연결 조각을 정확히 한 번만 관통해야 합니다.');
    }
    const [entry, exit] = events;
    if (exit.position - entry.position <= 1e-7) throw new Error('국경선의 내부 구간이 너무 짧습니다.');
    const middle = coordinateAtPathPosition(line, (entry.position + exit.position) / 2);
    const componentIndex = interiorComponentIndex(middle, polygons);
    if (componentIndex === null) throw new Error('두 국경 교차점 사이에 유효한 내부 구간이 없습니다.');
    if (entry.position > 1e-7) {
      const before = coordinateAtPathPosition(line, entry.position / 2);
      if (interiorComponentIndex(before, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 시작하세요.');
    }
    const maxPosition = line.length - 1;
    if (exit.position < maxPosition - 1e-7) {
      const after = coordinateAtPathPosition(line, (exit.position + maxPosition) / 2);
      if (interiorComponentIndex(after, polygons) !== null) throw new Error('국경선은 선택 영토 밖이나 경계에서 끝내세요.');
    }
    const entryRef = entry.refs.find(ref => ref.polygonIndex === componentIndex && ref.ringIndex === 0);
    const exitRef = exit.refs.find(ref => ref.polygonIndex === componentIndex && ref.ringIndex === 0);
    if (!entryRef || !exitRef) throw new Error('국경선은 같은 영토 조각의 외곽 경계를 관통해야 합니다.');

    const cutLine = [entry.coord.slice()];
    for (let vertexIndex = 1; vertexIndex < line.length - 1; vertexIndex += 1) {
      if (vertexIndex > entry.position + 1e-7 && vertexIndex < exit.position - 1e-7) cutLine.push(line[vertexIndex].slice());
    }
    if (!(0, dependencies.coordNear)(cutLine[cutLine.length - 1], exit.coord, 1e-9)) cutLine.push(exit.coord.slice());
    return {
      polygons,
      componentIndex,
      component: polygons[componentIndex],
      cutLine,
      firstEndpoint: {
        coord: entry.coord.slice(), segmentIndex: entryRef.boundarySegmentIndex, t: entryRef.boundaryT,
      },
      lastEndpoint: {
        coord: exit.coord.slice(), segmentIndex: exitRef.boundarySegmentIndex, t: exitRef.boundaryT,
      },
    };
  }

  function augmentedRingWithCutEndpoints(rawRing, firstEndpoint, lastEndpoint) {
    const open = (0, dependencies.ensureClosedRing)(rawRing).slice(0, -1).map(coord => coord.slice());
    const insertions = new Map();
    for (const endpoint of [firstEndpoint, lastEndpoint]) {
      if (endpoint.t <= 0.002 || endpoint.t >= 0.998) continue;
      if (!insertions.has(endpoint.segmentIndex)) insertions.set(endpoint.segmentIndex, []);
      insertions.get(endpoint.segmentIndex).push({ t: endpoint.t, coord: endpoint.coord.slice() });
    }
    const augmented = [];
    for (let i = 0; i < open.length; i += 1) {
      augmented.push(open[i].slice());
      const additions = (insertions.get(i) || []).sort((a, b) => a.t - b.t);
      for (const addition of additions) {
        if (!(0, dependencies.coordNear)(augmented[augmented.length - 1], addition.coord, 1e-9)) augmented.push(addition.coord.slice());
      }
    }
    const firstIndex = augmented.findIndex(coord => (0, dependencies.coordNear)(coord, firstEndpoint.coord, 1e-7));
    const lastIndex = augmented.findIndex(coord => (0, dependencies.coordNear)(coord, lastEndpoint.coord, 1e-7));
    if (firstIndex < 0 || lastIndex < 0 || firstIndex === lastIndex) {
      throw new Error('편입선의 양 끝점을 영토를 가져올 국가의 경계에서 구분할 수 없습니다.');
    }
    return { ring: augmented, firstIndex, lastIndex };
  }

  function walkRingArc(ring, startIndex, endIndex, step) {
    const result = [ring[startIndex].slice()];
    let index = startIndex;
    let guard = 0;
    while (index !== endIndex && guard++ <= ring.length + 1) {
      index = (index + step + ring.length) % ring.length;
      result.push(ring[index].slice());
    }
    if (index !== endIndex) throw new Error('영토를 가져올 국가의 경계 경로를 만들 수 없습니다.');
    return result;
  }

  function validateAnnexCutLine(cutLine, component) {
    if (!Array.isArray(cutLine) || cutLine.length < 2) throw new Error('새 국경선에는 두 점 이상이 필요합니다.');
    const unique = new Set(cutLine.map(coord => (0, dependencies.coordKey)(coord, 8)));
    if (unique.size < 2 || cutLine.some((coord, index) => index > 0 && (0, dependencies.coordNear)(coord, cutLine[index - 1], 1e-9))) {
      throw new Error('서로 다른 위치를 연결하세요.');
    }
    if (lineHasSelfIntersection(cutLine)) throw new Error('새 국경선이 자기 자신과 교차합니다.');
    for (let i = 1; i < cutLine.length - 1; i += 1) {
      if (!pointInPolygonSetInterior(cutLine[i], component)) {
        throw new Error('중간 국경점은 영토를 가져올 국가의 내부에 놓아야 합니다.');
      }
    }
    for (let i = 0; i < cutLine.length - 1; i += 1) {
      const a = cutLine[i], b = cutLine[i + 1];
      const projectedA = (0, dependencies.activeProjection)()(a);
      const projectedB = (0, dependencies.activeProjection)()(b);
      const screenLength = projectedA && projectedB ? Math.hypot(projectedB[0] - projectedA[0], projectedB[1] - projectedA[1]) : 120;
      const samples = (0, dependencies.clamp)(Math.ceil(screenLength / 5), 24, 160);
      for (let sample = 1; sample < samples; sample += 1) {
        const point = (0, dependencies.interpolateCoordinate)(a, b, sample / samples);
        if (!pointInPolygonSetInterior(point, component)) {
          throw new Error('새 국경선은 영토를 가져올 국가의 밖이나 호수·구멍을 통과할 수 없습니다.');
        }
      }
      for (const ring of component) {
        const closed = (0, dependencies.ensureClosedRing)(ring);
        for (let j = 0; j < closed.length - 1; j += 1) {
          if ((0, dependencies.segmentsProperlyIntersect)(a, b, closed[j], closed[j + 1])) {
            throw new Error('새 국경선이 영토를 가져올 국가의 경계를 중간에서 가로지릅니다.');
          }
        }
      }
    }
  }

  function buildCutSplitCandidates(sourceGeometry, rawLine) {
    const clipper = window.polygonClipping;
    if (!clipper?.intersection || !clipper?.union || !clipper?.xor) throw new Error('영토 편입 엔진을 불러오지 못했습니다.');
    if (!sourceGeometry || !['Polygon', 'MultiPolygon'].includes(sourceGeometry.type)) throw new Error('분할할 영토를 찾을 수 없습니다.');
    const { extracted } = prepareCutDraft(rawLine, sourceGeometry);
    const { component, componentIndex, cutLine, firstEndpoint, lastEndpoint } = extracted;
    if ((0, dependencies.coordNear)(firstEndpoint.coord, lastEndpoint.coord, 1e-7)) throw new Error('국경선의 양 끝점이 너무 가깝습니다.');
    validateAnnexCutLine(cutLine, component);

    const augmented = augmentedRingWithCutEndpoints(component[0], firstEndpoint, lastEndpoint);
    const forwardArc = walkRingArc(augmented.ring, augmented.firstIndex, augmented.lastIndex, 1);
    const backwardArc = walkRingArc(augmented.ring, augmented.firstIndex, augmented.lastIndex, -1);
    const candidateRings = [forwardArc, backwardArc].map(arc =>
      (0, dependencies.ensureClosedRing)([...cutLine.map(coord => coord.slice()), ...arc.slice(1, -1).reverse().map(coord => coord.slice())])
    );
    if (candidateRings.some(ring => Math.abs((0, dependencies.ringSignedArea)(ring)) <= 1e-14 || (0, dependencies.ringHasSelfIntersection)(ring))) {
      throw new Error('새 국경선으로 유효한 두 영토를 만들 수 없습니다.');
    }

    const candidates = candidateRings.map(ring => normalizeClippedLandGeometry(clipper.intersection([ring], component)));
    if (candidates.some(candidate => !candidate)) throw new Error('새 국경선 한쪽에 유효한 영토가 없습니다.');
    const componentArea = (0, dependencies.multiPolygonPlanarArea)([component]);
    const areas = candidates.map(candidate => (0, dependencies.multiPolygonPlanarArea)((0, dependencies.geometryMultiCoordinates)(candidate)));
    const tolerance = Math.max(1e-10, componentArea * 1e-10);
    if (areas.some(area => area <= tolerance)) throw new Error('새 국경선 한쪽 영토가 너무 작거나 비어 있습니다.');
    const overlapArea = (0, dependencies.multiPolygonPlanarArea)(clipper.intersection(candidates[0].coordinates, candidates[1].coordinates));
    const combined = clipper.union(candidates[0].coordinates, candidates[1].coordinates);
    const missingArea = (0, dependencies.multiPolygonPlanarArea)(clipper.xor(component, combined));
    if (overlapArea > tolerance || missingArea > tolerance) throw new Error('새 국경선이 영토를 가져올 국가를 정확히 두 영역으로 나누지 못했습니다.');

    return {
      componentIndex,
      cutLine,
      candidates: candidates.map((geometry, index) => ({ geometry, area: areas[index] })),
    };
  }

  function selectedCountryUnionGeometry(sourceIds) {
    const ids = new Set((sourceIds || []).map(String));
    if (!ids.size) throw new Error('영토를 가져올 국가를 하나 이상 선택하세요.');
    const union = (0, dependencies.countryUnionFromFeatures)(dependencies.state.countriesData?.features || [], ids);
    const geometry = normalizeClippedLandGeometry(union);
    if (!geometry) throw new Error('선택 국가의 영토 합집합을 만들 수 없습니다.');
    return geometry;
  }

  function applyWorkerCountryPatches(result) {
    const updates = new Map((result.features || []).map(feature => {
      const next = (0, dependencies.deepClone)(feature);
      const normalizedGeometry = (0, dependencies.normalizeCountryGeometry)(next.geometry);
      if (!normalizedGeometry) throw new Error(`${(0, dependencies.countryName)(next)}의 편집 결과가 유효하지 않습니다.`);
      next.geometry = normalizedGeometry;
      return [String(next.id || ''), next];
    }));
    const removed = new Set((result.removedIds || []).map(String));
    dependencies.state.countriesData.features = dependencies.state.countriesData.features.flatMap(feature => {
      const id = String(feature.id || '');
      if (removed.has(id)) {
        delete dependencies.state.countryOverrides[id];
        return [];
      }
      if (updates.has(id)) {
        const next = updates.get(id);
        updates.delete(id);
        return [next];
      }
      return [feature];
    });
    for (const feature of updates.values()) dependencies.state.countriesData.features.push(feature);
    (0, dependencies.reindexCountries)(dependencies.state.countriesData, true);
    dependencies.applyingMapEditWorkerResult = true;
    try {
      (0, dependencies.markCountryGeometriesChanged)(new Set(result.affectedIds || [...updates.keys(), ...removed]));
    } finally {
      dependencies.applyingMapEditWorkerResult = false;
    }
  }



  return Object.freeze({
    connect,

    get activeCutDraftSourceGeometry() { return activeCutDraftSourceGeometry; },
    get applyWorkerCountryPatches() { return applyWorkerCountryPatches; },
    get assessCutDraft() { return assessCutDraft; },
    get boundsOverlap() { return boundsOverlap; },
    get buildCutSplitCandidates() { return buildCutSplitCandidates; },
    get coordinateBounds() { return coordinateBounds; },
    get normalizeClippedLandGeometry() { return normalizeClippedLandGeometry; },
    get segmentIntersectionDetail() { return segmentIntersectionDetail; },
    get selectedCountryUnionGeometry() { return selectedCountryUnionGeometry; },
  });
}
