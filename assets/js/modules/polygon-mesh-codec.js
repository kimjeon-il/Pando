const MAGIC = 0x50474d31;
const FORMAT = 1;
const fields = [['positions', Float32Array], ['indices', Uint32Array], ['featureIds', Uint32Array],
  ['ringCoordinates', Float64Array], ['ringOffsets', Uint32Array], ['polygonOffsets', Uint32Array]];
const headerWords = 4 + fields.length;
const align = (offset, size) => Math.ceil(offset / size) * size;

export function encodePolygonMesh(packet) {
  let bytes = headerWords * 4;
  for (const [name, Type] of fields) bytes = align(bytes, Type.BYTES_PER_ELEMENT) + packet[name].byteLength;
  const buffer = new ArrayBuffer(bytes), header = new Uint32Array(buffer, 0, headerWords);
  header.set([MAGIC, FORMAT, packet.algorithmVersion, Math.round(packet.maxEdgeDegrees * 1e6)]);
  let offset = headerWords * 4;
  fields.forEach(([name, Type], index) => {
    header[index + 4] = packet[name].length;
    offset = align(offset, Type.BYTES_PER_ELEMENT);
    new Type(buffer, offset, packet[name].length).set(packet[name]); offset += packet[name].byteLength;
  });
  return buffer;
}

export function decodePolygonMesh(buffer, { algorithmVersion } = {}) {
  const fail = detail => { throw Object.assign(new Error(`Invalid prepared polygon mesh: ${detail}`), { code: 'PL-MESH-ASSET' }); };
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < headerWords * 4) fail('header');
  const header = new Uint32Array(buffer, 0, headerWords);
  if (header[0] !== MAGIC || header[1] !== FORMAT || header[2] !== algorithmVersion || header[3] > 499001) fail('format, algorithm or spherical precision');
  const packet = { algorithmVersion: header[2], maxEdgeDegrees: header[3] / 1e6 };
  let offset = headerWords * 4;
  fields.forEach(([name, Type], index) => {
    offset = align(offset, Type.BYTES_PER_ELEMENT);
    const length = header[index + 4], bytes = length * Type.BYTES_PER_ELEMENT;
    if (offset + bytes > buffer.byteLength) fail(name);
    packet[name] = new Type(buffer, offset, length); offset += bytes;
  });
  if (offset !== buffer.byteLength || packet.positions.length % 2 || packet.indices.length % 3
    || packet.featureIds.length !== packet.positions.length / 2) fail('length');
  packet.vertexCount = packet.positions.length / 2; packet.triangleCount = packet.indices.length / 3;
  if (!packet.triangleCount) fail('empty triangulation');
  for (const index of packet.indices) if (index >= packet.vertexCount) fail('vertex index');
  return Object.freeze(packet);
}
