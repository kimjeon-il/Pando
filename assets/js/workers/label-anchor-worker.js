'use strict';

if (typeof importScripts === 'function' && !self.d3) importScripts('../vendor/d3.min.js');

(() => {
  const normalizeLongitude = value => {
    let lon = Number(value || 0);
    while (lon > 180) lon -= 360;
    while (lon < -180) lon += 360;
    return lon;
  };

  function polygonComponents(geometry) {
    if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
    if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
    return [];
  }

  function largestPolygon(geometry) {
    let best = null;
    let bestArea = -Infinity;
    for (const coordinates of polygonComponents(geometry)) {
      let area;
      try { area = self.d3.geo.area({ type: 'Polygon', coordinates }); }
      catch (_) { area = 0; }
      if (area > bestArea) {
        bestArea = area;
        best = coordinates;
      }
    }
    return best;
  }

  function cleanRing(rawRing) {
    const ring = (rawRing || []).filter(point => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
      .map(point => [Number(point[0]), Number(point[1])]);
    if (ring.length > 1) {
      const first = ring[0], last = ring[ring.length - 1];
      if (Math.abs(first[0] - last[0]) <= 1e-12 && Math.abs(first[1] - last[1]) <= 1e-12) ring.pop();
    }
    return ring;
  }

  function unwrapRing(rawRing, reference = null) {
    const ring = cleanRing(rawRing);
    if (!ring.length) return [];
    let firstLon = normalizeLongitude(ring[0][0]);
    if (Number.isFinite(reference)) {
      while (firstLon - reference > 180) firstLon -= 360;
      while (firstLon - reference < -180) firstLon += 360;
    }
    const output = [[firstLon, ring[0][1]]];
    let previous = firstLon;
    for (let index = 1; index < ring.length; index += 1) {
      let lon = normalizeLongitude(ring[index][0]);
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
      output.push([lon, ring[index][1]]);
      previous = lon;
    }
    return output;
  }

  function getSegDistSq(px, py, a, b) {
    let x = a[0], y = a[1];
    let dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; }
      else if (t > 0) { x += dx * t; y += dy * t; }
    }
    dx = px - x;
    dy = py - y;
    return dx * dx + dy * dy;
  }

  function pointToPolygonDist(x, y, polygon) {
    let inside = false;
    let minDistSq = Infinity;
    for (const ring of polygon) {
      for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
        const a = ring[index], b = ring[previous];
        if (((a[1] > y) !== (b[1] > y)) && (x < (b[0] - a[0]) * (y - a[1]) / ((b[1] - a[1]) || 1e-30) + a[0])) inside = !inside;
        minDistSq = Math.min(minDistSq, getSegDistSq(x, y, a, b));
      }
    }
    const distance = Math.sqrt(minDistSq);
    return inside ? distance : -distance;
  }

  class Cell {
    constructor(x, y, h, polygon) {
      this.x = x;
      this.y = y;
      this.h = h;
      this.d = pointToPolygonDist(x, y, polygon);
      this.max = this.d + this.h * Math.SQRT2;
    }
  }

  class MaxHeap {
    constructor() { this.items = []; }
    push(value) {
      const items = this.items;
      items.push(value);
      let index = items.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (items[parent].max >= value.max) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = value;
    }
    pop() {
      const items = this.items;
      const top = items[0];
      const end = items.pop();
      if (items.length && end) {
        let index = 0;
        while (true) {
          const left = index * 2 + 1;
          const right = left + 1;
          if (left >= items.length) break;
          const child = right < items.length && items[right].max > items[left].max ? right : left;
          if (items[child].max <= end.max) break;
          items[index] = items[child];
          index = child;
        }
        items[index] = end;
      }
      return top;
    }
    get length() { return this.items.length; }
  }

  function centroidCell(polygon) {
    const ring = polygon[0];
    let area = 0, x = 0, y = 0;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const a = ring[index], b = ring[previous];
      const cross = a[0] * b[1] - b[0] * a[1];
      x += (a[0] + b[0]) * cross;
      y += (a[1] + b[1]) * cross;
      area += cross * 3;
    }
    if (Math.abs(area) < 1e-18) return new Cell(ring[0][0], ring[0][1], 0, polygon);
    return new Cell(x / area, y / area, 0, polygon);
  }

  function polylabel(polygon) {
    const outer = polygon[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of outer) {
      minX = Math.min(minX, point[0]); minY = Math.min(minY, point[1]);
      maxX = Math.max(maxX, point[0]); maxY = Math.max(maxY, point[1]);
    }
    const width = maxX - minX, height = maxY - minY;
    const cellSize = Math.min(width, height);
    if (!(cellSize > 0)) return outer[0];
    const heap = new MaxHeap();
    const h = cellSize / 2;
    for (let x = minX; x < maxX; x += cellSize) {
      for (let y = minY; y < maxY; y += cellSize) heap.push(new Cell(x + h, y + h, h, polygon));
    }
    let best = centroidCell(polygon);
    const bbox = new Cell(minX + width / 2, minY + height / 2, 0, polygon);
    if (bbox.d > best.d) best = bbox;
    const precision = Math.max(0.0015, cellSize / 512);
    while (heap.length) {
      const cell = heap.pop();
      if (cell.d > best.d) best = cell;
      if (cell.max - best.d <= precision) continue;
      const nextH = cell.h / 2;
      heap.push(new Cell(cell.x - nextH, cell.y - nextH, nextH, polygon));
      heap.push(new Cell(cell.x + nextH, cell.y - nextH, nextH, polygon));
      heap.push(new Cell(cell.x - nextH, cell.y + nextH, nextH, polygon));
      heap.push(new Cell(cell.x + nextH, cell.y + nextH, nextH, polygon));
    }
    return [best.x, best.y];
  }

  function computeFeatureLabelAnchor(feature) {
    const polygon = largestPolygon(feature?.geometry);
    if (!polygon?.[0]?.length) return null;
    const outer = unwrapRing(polygon[0]);
    if (outer.length < 3) return null;
    const reference = outer.reduce((sum, point) => sum + point[0], 0) / outer.length;
    const rings = [outer, ...polygon.slice(1).map(ring => unwrapRing(ring, reference)).filter(ring => ring.length >= 3)];
    const meanLat = outer.reduce((sum, point) => sum + point[1], 0) / outer.length;
    const xScale = Math.max(0.08, Math.cos(meanLat * Math.PI / 180));
    const projected = rings.map(ring => ring.map(point => [(point[0] - reference) * xScale, point[1]]));
    const best = polylabel(projected);
    if (!best) return null;
    return [normalizeLongitude(best[0] / xScale + reference), Math.max(-90, Math.min(90, best[1]))];
  }

  const core = { computeFeatureLabelAnchor, largestPolygon, pointToPolygonDist };
  self.AtlasWrightLabelAnchorCore = core;

  if (typeof self.addEventListener === 'function') {
    self.addEventListener('message', event => {
      const requestId = Number(event.data?.requestId || 0);
      const items = event.data?.items || [];
      try {
        const results = items.map(item => ({
          id: String(item.id || ''),
          version: Number(item.version || 0),
          anchor: computeFeatureLabelAnchor({ type: 'Feature', geometry: item.geometry, properties: {} }),
        }));
        self.postMessage({ type: 'anchors', requestId, results });
      } catch (error) {
        self.postMessage({ type: 'error', requestId, message: error?.message || String(error) });
      }
    });
  }
})();
