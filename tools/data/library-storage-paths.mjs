import {isDeepStrictEqual} from 'node:util';

// Storage locations are independent of the original logical file keys.
// Keep direct runtime assets and owner-published reports at their public paths.
export function libraryStoragePath(logical, { sha256, encoding, direct = false }) {
  if (typeof logical !== 'string' || !logical || logical.includes('\\') || logical.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw Error('Unsafe library storage path');
  if (direct || logical.startsWith('reports/')) return logical;
  if (!/^[a-f0-9]{64}$/.test(sha256) || !['identity', 'gzip'].includes(encoding)) throw Error('Invalid library storage identity');
  let directory = 'archive/blobs';
  if (logical.startsWith('tools/historical-library/')) directory = 'assets/data/reference-sources/historical';
  else if (logical.startsWith('assets/data/')) {
    const relative = logical.slice('assets/data/'.length);
    const subject = relative.includes('/') ? relative.split('/')[0] : 'legacy-world';
    directory = `assets/data/${subject}/.originals`;
  }
  return `${directory}/${sha256}.${encoding === 'gzip' ? 'gz' : 'bin'}`;
}

// A newer checkout may relocate identical bytes without changing the pinned data.
// Reuse only the reviewed classified destination, never another data edition.
export function preserveClassifiedStorage(logical, pinned, current) {
  if (!pinned?.stored?.startsWith('archive/blobs/') || !current
    || !['identity', 'gzip'].includes(pinned.encoding)
    || !/^[a-f0-9]{64}$/.test(pinned.sha256 || '')) return pinned;
  const {stored: oldPath, ...oldMetadata} = pinned;
  const {stored: newPath, ...newMetadata} = current;
  if (!isDeepStrictEqual(oldMetadata, newMetadata)
    || newPath !== libraryStoragePath(logical, pinned)) return pinned;
  return {...pinned, stored: newPath};
}
