export function decodeCountryMesh(buffer, ids = []) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 32) throw new Error("Invalid country mesh buffer");
  const prefix = new Uint32Array(buffer, 0, 8);
  const formatVersion = Number(prefix[1]);
  const headerWords = formatVersion >= 2 ? 12 : 8;
  const header = new Uint32Array(buffer, 0, headerWords);
  if (header[0] !== 0x434d4731 || ![1, 2].includes(formatVersion) || header[2] !== 258 || header[6] < 1 || header[7] !== 3) {
    throw new Error('외부 GPU 메시 형식 또는 알고리즘 리비전이 올바르지 않습니다.');
  }
  const countryCount = header[2];
  const vertexCount = header[3];
  const triangleIndexCount = header[4];
  const lineIndexCount = header[5];
  const triangleRangeLength = formatVersion >= 2 ? Number(header[8]) : 0;
  const boundaryRangeLength = formatVersion >= 2 ? Number(header[9]) : 0;
  const boundsLength = formatVersion >= 2 ? Number(header[10]) : 0;
  const boundsFlagsLength = formatVersion >= 2 ? Number(header[11]) : 0;
  if (formatVersion >= 2 && (
    triangleRangeLength !== countryCount * 2
    || boundaryRangeLength !== countryCount * 2
    || boundsLength !== countryCount * 4
    || boundsFlagsLength !== countryCount
  )) throw new Error('외부 GPU 메시의 국가별 범위 메타데이터가 손상되었습니다.');
  let offset = headerWords * 4;
  const positions = new Int32Array(buffer, offset, vertexCount * 2);
  offset += positions.byteLength;
  const countryIndices = new Uint16Array(buffer, offset, vertexCount);
  offset += (countryIndices.byteLength + 3) & ~3;
  const triangleIndices = new Uint32Array(buffer, offset, triangleIndexCount);
  offset += triangleIndices.byteLength;
  const lineIndices = new Uint32Array(buffer, offset, lineIndexCount);
  offset += lineIndices.byteLength;
  const countryTriangleRanges = formatVersion >= 2 ? new Uint32Array(buffer, offset, triangleRangeLength) : null;
  offset += countryTriangleRanges?.byteLength || 0;
  const countryBoundaryRanges = formatVersion >= 2 ? new Uint32Array(buffer, offset, boundaryRangeLength) : null;
  offset += countryBoundaryRanges?.byteLength || 0;
  const countryBounds = formatVersion >= 2 ? new Int32Array(buffer, offset, boundsLength) : null;
  offset += countryBounds?.byteLength || 0;
  const countryBoundsFlags = formatVersion >= 2 ? new Uint32Array(buffer, offset, boundsFlagsLength) : null;
  offset += countryBoundsFlags?.byteLength || 0;
  if (offset !== buffer.byteLength) throw new Error('외부 GPU 메시의 크기가 헤더와 일치하지 않습니다.');
  return {
    mesh: {
      positions,
      countryIndices,
      triangleIndices,
      lineIndices,
      countryTriangleRanges,
      countryBoundaryRanges,
      countryBounds,
      countryBoundsFlags,
      metadataCountryIds: ids,
    },
    ids,
    sourceCoordinateCount: header[6],
    buffer,
  };
}
