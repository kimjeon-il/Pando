import { normalizeReferenceImageRecord, serializeReferenceImageRecord, REFERENCE_IMAGE_MODEL_VERSION } from './reference-image-model.js';
import { referenceImageSourceHash } from './reference-image-source.js';

const error = (message, code) => Object.assign(new Error(message), { code });
const types = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maximumBytes = 256 * 1024 * 1024;
function encode(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export async function packReferenceImages(records) {
  const sources = new Map(), rows = [], ids = new Set();
  let total = 0;
  for (const [order, record] of records.entries()) {
    if (!record.id || ids.has(record.id) || !(record.blob instanceof Blob) || !types.has(record.blob.type)) throw error('참조 이미지 저장 데이터가 올바르지 않습니다.', 'PL-REF-PACKAGE-RECORD');
    ids.add(record.id);
    const sourceHash = await referenceImageSourceHash(record.blob);
    if (!sources.has(sourceHash)) {
      total += record.blob.size;
      if (total > maximumBytes) throw error('참조 이미지 원본 합계가 256MiB 저장 한도를 초과합니다.', 'PL-REF-PACKAGE-BUDGET');
      sources.set(sourceHash, { sha256: sourceHash, mimeType: record.blob.type, bytes: record.blob.size, base64: encode(new Uint8Array(await record.blob.arrayBuffer())) });
    }
    const { blob: _blob, ...metadata } = serializeReferenceImageRecord(record, order);
    rows.push({ ...metadata, sourceHash });
  }
  return { schemaVersion: 1, sources: [...sources.values()], records: rows };
}
export async function unpackReferenceImages(value) {
  if (value === undefined) return [];
  if (value?.schemaVersion !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.records)) throw error('참조 이미지 패키지 버전이 올바르지 않습니다.', 'PL-REF-PACKAGE-VERSION');
  const sources = new Map(), ids = new Set(), used = new Set();
  let total = 0;
  for (const source of value.sources) {
    if (!/^[a-f0-9]{64}$/u.test(source.sha256) || sources.has(source.sha256) || !types.has(source.mimeType)
      || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || typeof source.base64 !== 'string') throw error('참조 이미지 원본 정보가 올바르지 않습니다.', 'PL-REF-PACKAGE-SOURCE');
    total += source.bytes;
    if (total > maximumBytes || source.base64.length > Math.ceil(source.bytes / 3) * 4) throw error('참조 이미지 저장 크기가 올바르지 않습니다.', 'PL-REF-PACKAGE-BUDGET');
    let bytes;
    try { bytes = Uint8Array.from(atob(source.base64), character => character.charCodeAt(0)); }
    catch (cause) { throw Object.assign(error('참조 이미지 원본을 읽을 수 없습니다.', 'PL-REF-PACKAGE-SOURCE'), { cause }); }
    const blob = new Blob([bytes], { type: source.mimeType });
    if (bytes.length !== source.bytes || await referenceImageSourceHash(blob) !== source.sha256) throw error('참조 이미지 원본의 해시가 일치하지 않습니다.', 'PL-REF-PACKAGE-HASH');
    sources.set(source.sha256, blob);
  }
  const records = value.records.map(record => {
    if (!record.id || ids.has(record.id) || record.modelVersion !== REFERENCE_IMAGE_MODEL_VERSION) throw error('참조 이미지 항목이 중복되었거나 버전이 다릅니다.', 'PL-REF-PACKAGE-RECORD');
    const blob = sources.get(record.sourceHash);
    if (!blob) throw error('참조 이미지 항목의 원본이 없습니다.', 'PL-REF-PACKAGE-SOURCE');
    ids.add(record.id);used.add(record.sourceHash);
    const normalized = normalizeReferenceImageRecord({ ...record, blob });
    if (!normalized.mapQuad) throw error('참조 이미지 배치 정보가 없습니다.', 'PL-REF-PACKAGE-RECORD');
    return normalized;
  });
  if (used.size !== sources.size) throw error('사용하지 않는 참조 이미지 원본이 패키지에 포함되어 있습니다.', 'PL-REF-PACKAGE-SOURCE');
  return records;
}
