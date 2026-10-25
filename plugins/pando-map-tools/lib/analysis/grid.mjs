import { detectReferenceMapLines } from './layout.mjs';

/** Numeric normalization is for interpretation only; never overwrite source transcription. */
export function parseReferenceCoordinate(originalText) {
  const text = String(originalText).normalize('NFKC').replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/[٠-٩۰-۹]/gu, digit => String(digit.codePointAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)))
    .replace(/٫/gu, '.').replace(/′′/gu, '″').trim().toUpperCase();
  const match = text.match(/^(?:(N|S|E|W)\s*)?(\d{1,3}(?:\.\d+)?)\s*[°º](?:\s*(\d{1,2}(?:\.\d+)?)\s*['′](?:\s*(\d{1,2}(?:\.\d+)?)\s*["″])?)?\s*(N|S|E|W)?$/u);
  if (!match || (!match[1] && !match[5]) || (match[1] && match[5] && match[1] !== match[5])) return null;
  const hemisphere = match[1] || match[5], degrees = Number(match[2]), minutes = Number(match[3] || 0), seconds = Number(match[4] || 0);
  if (minutes >= 60 || seconds >= 60 || (match[2].includes('.') && match[3]) || (match[3]?.includes('.') && match[4])) return null;
  const axis = /[NS]/u.test(hemisphere) ? 'latitude' : 'longitude';
  const value = degrees + minutes / 60 + seconds / 3600;
  if (value > (axis === 'latitude' ? 90 : 180)) return null;
  return { originalText, axis, value: value * (/[SW]/u.test(hemisphere) ? -1 : 1) };
}

/** Straight visible graticules only. Values stay provisional until the source CRS is confirmed. */
export function detectReferenceGraticule(raster, blocks) {
  const { width, height } = raster, lines = detectReferenceMapLines(raster);
  const assigned = { longitude: new Map(), latitude: new Map() }, labels = [], unresolved = [];
  for (const [index, block] of blocks.entries()) {
    const parsed = parseReferenceCoordinate(block.rawValue);
    if (!parsed) continue;
    const label = { id: `grid-label:${index}`, ...parsed, boundingBox: { ...block.boundingBox } };
    labels.push(label);
    const vertical = label.axis === 'longitude', box = label.boundingBox;
    const axis = vertical ? box.x + box.width / 2 : box.y + box.height / 2;
    const end = vertical ? box.y + box.height / 2 : box.x + box.width / 2;
    const tolerance = (vertical ? box.width : box.height) / 2 + 3;
    const candidates = (vertical ? lines.vertical : lines.horizontal).filter(line => Math.abs(line.axis - axis) <= tolerance
      && Math.min(Math.abs(end - line.start), Math.abs(end - line.end)) <= Math.max(16, (vertical ? height : width) * .08));
    if (candidates.length !== 1) { unresolved.push(label.id);continue; }
    const line = candidates[0], values = assigned[label.axis].get(line.axis) || [];
    values.push({ label, line }); assigned[label.axis].set(line.axis, values);
  }
  const unambiguous = axis => [...assigned[axis].values()].flatMap(values => {
    if (new Set(values.map(row => row.label.value)).size > 1) { unresolved.push(...values.map(row => row.label.id));return []; }
    return [values[0]];
  }).sort((a, b) => a.line.axis - b.line.axis);
  const longitude = unambiguous('longitude'), latitude = unambiguous('latitude'), points = [];
  for (const lon of longitude) for (const lat of latitude) {
    const x = lon.line.axis, y = lat.line.axis;
    if (y < lon.line.start || y > lon.line.end || x < lat.line.start || x > lat.line.end) continue;
    points.push({ id: `grid:${lon.label.id}:${lat.label.id}`, image: [x / width, y / height], coordinate: [lon.label.value, lat.label.value],
      longitudeLabelId: lon.label.id, latitudeLabelId: lat.label.id });
  }
  return { coordinateSystem: 'unverified', labels, points: points.slice(0, 64), unresolved,
    independentLongitudeLabels: longitude.length, independentLatitudeLabels: latitude.length };
}
