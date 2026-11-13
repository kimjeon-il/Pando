// The data archive owns byte identity; viewer paths are only logical names.
const HEX = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SAFE = /^(?:assets\/data|archive\/blobs)\/[A-Za-z0-9._/-]+$/;
const validPath = value => SAFE.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');

export function validateExternalRuntimeData(value) {
  if (!value || !REVISION.test(value.revision || '') || !value.files || typeof value.files !== 'object')
    throw new TypeError('Invalid external runtime data identity');
  for (const [path, entry] of Object.entries(value.files)) {
    if (!validPath(path) || !path.startsWith('assets/data/') || !validPath(entry?.stored || '')
        || !['identity', 'gzip'].includes(entry.encoding) || !HEX.test(entry.sha256 || '')
        || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0)
      throw new TypeError('Invalid external runtime data entry: ' + path);
    if (entry.segments && (!Array.isArray(entry.segments) || entry.encoding !== 'identity'
        || entry.segments.some(part => !Number.isSafeInteger(part.offset) || part.offset < 0
          || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.offset + part.bytes > entry.bytes
          || !HEX.test(part.sha256 || '')))) throw new TypeError('Invalid external data segments: ' + path);
  }
  return value;
}

/** Fetch and verify one logical runtime asset from a single immutable archive. */
export function createExternalRuntimeDataFetch({ meta, fetchFn = globalThis.fetch } = {}) {
  const external = meta?.externalRuntimeData;
  if (!external) return fetchFn;
  validateExternalRuntimeData(external);
  return async function fetchRuntimeData(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : input, globalThis.location?.href);
    if (globalThis.location?.origin && url.origin !== globalThis.location.origin) return fetchFn(input, init);
    const marker = url.pathname.lastIndexOf('/assets/data/');
    if (marker < 0) return fetchFn(input, init);
    const logical = decodeURIComponent(url.pathname.slice(marker + 1));
    const entry = external.files[logical];
    // The generated project manifest is part of the viewer bootstrap, not the archive.
    if (!entry && /^assets\/data\/projects\/[a-z0-9-]+\/manifest\.json$/.test(logical)) return fetchFn(input, init);
    if (!entry) throw new Error('Missing pinned external runtime data: ' + logical);
    const rawUrl = `https://raw.githubusercontent.com/kimjeon-il/PandoLab-library/${external.revision}/${entry.stored}`;
    const headers = new Headers(init.headers || request?.headers);
    const range = headers.get('Range'), match = range && /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(match?.[1]), end = Number(match?.[2]);
    if (range && (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= entry.bytes))
      throw new RangeError('Invalid external runtime data range: ' + logical);
    const segment = range && entry.segments?.filter(part => part.offset <= start && part.offset + part.bytes > end)
      .sort((a,b) => a.bytes - b.bytes)[0];
    const response = await fetchFn(rawUrl, { signal: init.signal || request?.signal, cache: init.cache,
      ...(segment ? {headers:{Range:`bytes=${segment.offset}-${segment.offset + segment.bytes - 1}`}} : {}) });
    if (!response.ok) throw Object.assign(new Error(`External runtime data HTTP ${response.status}: ${logical}`), {httpStatus:response.status});
    let bytes = await response.arrayBuffer();
    if (segment && response.status !== 206) throw new Error('External runtime segment requires HTTP 206: ' + logical);
    if (!segment && entry.encoding === 'gzip') {
      if (typeof DecompressionStream !== 'function') throw new Error('External archive gzip decoding is unavailable');
      bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    const expected = segment || entry;
    if (bytes.byteLength !== expected.bytes) throw new Error('External runtime data length mismatch: ' + logical);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expected.sha256) throw new Error('External runtime data hash mismatch: ' + logical);
    if (!range) return new Response(bytes, { status: 200, headers: { 'Content-Length': String(bytes.byteLength) } });
    const offset = segment?.offset || 0;
    return new Response(bytes.slice(start - offset, end - offset + 1), { status: 206, headers: {
      'Content-Range': `bytes ${start}-${end}/${entry.bytes}`, 'Content-Length': String(end - start + 1),
    } });
  };
}
