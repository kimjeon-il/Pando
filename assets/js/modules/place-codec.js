import { normalizePlace, PLACE_KINDS, PLACE_LIMITS, PLACE_TILE_FORMAT } from './place-contract.js';
const { headerBytes: HEADER, recordBytes: STRIDE, magic: MAGIC, version: VERSION,
  stringFields: STRING_FIELDS, stringOffsetBase: STRING_OFFSET_BASE,
  stringOffsetStride: STRING_OFFSET_STRIDE, maxStringBytes: MAX_STRING_BYTES } = PLACE_TILE_FORMAT;
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });

export function encodePlaceTile(records) {
  if (!Array.isArray(records) || records.length > PLACE_LIMITS.tileRecords) throw new RangeError('Place tile record budget exceeded');
  const normalized = records.map(normalizePlace);
  const strings = new Map(); let poolBytes = 0;
  for (const record of normalized) {
    for (const field of STRING_FIELDS) {
      const value = field === 'nameTimelineText' ? JSON.stringify(record.nameTimeline)
        : field === 'nameNativeExtrasText' ? JSON.stringify(record.nameNativeExtras) : record[field];
      if (!strings.has(value)) { const bytes = encoder.encode(value); if (bytes.length > MAX_STRING_BYTES) throw new RangeError('Place string byte budget exceeded'); strings.set(value, { offset: poolBytes, bytes }); poolBytes += 4 + bytes.length; }
    }
  }
  const total = HEADER + STRIDE * records.length + poolBytes;
  if (total > PLACE_LIMITS.shardBytes) throw new RangeError('Place tile byte budget exceeded');
  const result = new ArrayBuffer(total), view = new DataView(result), bytes = new Uint8Array(result);
  view.setUint32(0, MAGIC, true); view.setUint16(4, VERSION, true); view.setUint16(6, STRIDE, true);
  view.setUint32(8, records.length, true); view.setUint32(12, poolBytes, true); view.setUint32(16, total, true);
  const poolStart = HEADER + STRIDE * records.length;
  for (const { offset, bytes: stringBytes } of strings.values()) { view.setUint32(poolStart + offset, stringBytes.length, true); bytes.set(stringBytes, poolStart + offset + 4); }
  normalized.forEach((record, i) => {
    const base = HEADER + i * STRIDE;
    view.setFloat64(base, record.coordinates[0], true); view.setFloat64(base + 8, record.coordinates[1], true);
    view.setFloat64(base + 16, record.population, true); view.setFloat32(base + 24, record.priority, true); view.setFloat32(base + 28, record.minZoom, true);
    view.setUint8(base + 32, PLACE_KINDS.indexOf(record.kind));
    STRING_FIELDS.forEach((field, j) => {
      const value = field === 'nameTimelineText' ? JSON.stringify(record.nameTimeline)
        : field === 'nameNativeExtrasText' ? JSON.stringify(record.nameNativeExtras) : record[field];
      view.setUint32(base + STRING_OFFSET_BASE + j * STRING_OFFSET_STRIDE, strings.get(value).offset, true);
    });
  });
  return result;
}
export function decodePlaceTile(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength < HEADER || bytes.byteLength > PLACE_LIMITS.shardBytes) throw new RangeError('Invalid place tile length');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC || view.getUint16(4, true) !== VERSION || view.getUint16(6, true) !== STRIDE) throw new TypeError('Invalid place tile header');
  const count = view.getUint32(8, true), poolBytes = view.getUint32(12, true), poolStart = HEADER + STRIDE * count;
  if (count > PLACE_LIMITS.tileRecords || poolStart + poolBytes !== bytes.length || view.getUint32(16, true) !== bytes.length) throw new RangeError('Invalid place tile table');
  const pool = new Map();
  for (let offset = 0; offset < poolBytes;) {
    if (offset + 4 > poolBytes) throw new RangeError('Invalid place string header');
    const length = view.getUint32(poolStart + offset, true);
    if (length > MAX_STRING_BYTES || offset + 4 + length > poolBytes) throw new RangeError('Invalid place string length');
    pool.set(offset, decoder.decode(bytes.subarray(poolStart + offset + 4, poolStart + offset + 4 + length)));
    offset += 4 + length;
  }
  return Array.from({ length: count }, (_, i) => {
    const base = HEADER + i * STRIDE;
    const raw = { coordinates: [view.getFloat64(base, true), view.getFloat64(base + 8, true)], population: view.getFloat64(base + 16, true), priority: view.getFloat32(base + 24, true), minZoom: view.getFloat32(base + 28, true), kind: PLACE_KINDS[view.getUint8(base + 32)] };
    if (!raw.kind) throw new TypeError('Invalid place kind');
    STRING_FIELDS.forEach((field, j) => { const offset = view.getUint32(base + STRING_OFFSET_BASE + j * STRING_OFFSET_STRIDE, true); if (!pool.has(offset)) throw new RangeError('Invalid place string offset'); raw[field] = pool.get(offset); });
    try {
      raw.nameNativeExtras = JSON.parse(raw.nameNativeExtrasText);
      raw.nameTimeline = JSON.parse(raw.nameTimelineText);
    } catch { throw new TypeError('Invalid place name metadata payload'); }
    return normalizePlace(raw);
  });
}
