// File primitives for the library-data owner. Mutable working files never share
// an inode with the immutable pool; Windows readonly attributes are restored
// even when a link replacement fails or is interrupted.
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep, isAbsolute } from 'node:path';

export const contentHash = bytes => createHash('sha256').update(bytes).digest('hex');
const storeRoot = store => typeof store === 'string' ? store : store.root;
const blobDirectory = store => typeof store === 'string' ? '.pando-store/blobs' : store.blobDirectory;
const permissionMarker = store => containedPath(storeRoot(store), blobDirectory(store) === '.pando-store/blobs' ? '.pando-store/.permission-restore.json' : '.permission-restore.json');
function contentTarget(store, target) {
  if (typeof store === 'object' && store.view) {
    const { viewRoot, marker } = store.view;
    if (!/^[.\w-]+$/.test(marker)) throw Error('Invalid content view ownership marker');
    const owner = containedPath(viewRoot, marker);
    if (!existsSync(owner) || !lstatSync(owner).isFile()) throw Error('Content view ownership is not established');
    return containedPath(viewRoot, target);
  }
  return containedPath(storeRoot(store), target);
}
const viewStore = (store, view) => ({ root: storeRoot(store), blobDirectory: blobDirectory(store), view });
export const linkContentView = (store, sha256, target, view) => linkContent(viewStore(store, view), sha256, target);
export const removeContentView = (store, target, view) => removeContentLink(viewStore(store, view), target);
export const makeContentViewPrivate = (store, target, view) => makePrivate(viewStore(store, view), target);
export function contentPath(shared, sha256) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error('Invalid content hash');
  return containedPath(storeRoot(shared), `${blobDirectory(shared)}/${sha256}`);
}
export function containedPath(base, value) {
  base = resolve(base); const target = resolve(base, value), rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error(`Path escaped library scope: ${target}`);
  for (let p = base; dirname(p) !== p; p = dirname(p)) if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error(`Linked library scope must be preserved: ${p}`);
  for (let p = target; p !== base; p = dirname(p)) if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw Error(`Linked library path must be preserved: ${p}`);
  return target;
}
export function atomicStorageJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.pending`;
  let created = false;
  try { writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx' }); created = true; renameSync(temporary, path); }
  finally { if (created && existsSync(temporary)) unlinkSync(temporary); }
}
export function contentFiles(base) {
  if (!existsSync(base)) return [];
  const result = [];
  const visit = path => {
    const s = lstatSync(path); if (s.isSymbolicLink()) throw Error(`Linked content must be preserved: ${path}`);
    if (s.isDirectory()) for (const name of readdirSync(path)) visit(resolve(path, name));
    else if (s.isFile()) result.push({ path, logical: relative(base, path).replaceAll('\\', '/'), bytes: s.size, mtime: s.mtimeMs, ctime: s.ctimeMs });
  }; visit(base); return result;
}
function exactContent(path, sha256, bytes) {
  const s = lstatSync(path);
  if (s.isSymbolicLink() || !s.isFile() || (bytes !== undefined && s.size !== bytes) || contentHash(readFileSync(path)) !== sha256) throw Error(`Modified content pool object: ${path}`);
}
export function recoverContentPermissions(shared) {
  const marker = permissionMarker(shared);
  if (!existsSync(marker)) return;
  const { sha256 } = JSON.parse(readFileSync(marker, 'utf8')), blob = contentPath(shared, sha256);
  if (existsSync(blob)) { exactContent(blob, sha256); chmodSync(blob, 0o400); }
  unlinkSync(marker);
}
export function publishContent(shared, bytes) {
  recoverContentPermissions(shared);
  const sha256 = contentHash(bytes), path = contentPath(shared, sha256);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) exactContent(path, sha256, bytes.length);
  else {
    const temporary = path + `.${process.pid}.pending`;
    let created = false;
    try { writeFileSync(temporary, bytes, { flag: 'wx' }); created = true; renameSync(temporary, path); }
    finally { if (created && existsSync(temporary)) unlinkSync(temporary); }
  }
  chmodSync(path, 0o400); return { path, sha256, bytes: bytes.length };
}
export function removeContentLink(shared, target) {
  target = contentTarget(shared, target); recoverContentPermissions(shared);
  const s = lstatSync(target); if (!s.isFile()) throw Error('Expected a plain content link');
  if ((s.mode & 0o200) && s.nlink === 1) { unlinkSync(target); return; }
  const sha256 = contentHash(readFileSync(target)), blob = contentPath(shared, sha256);
  if (target === blob || !existsSync(blob)) throw Error(`Unowned readonly content must be preserved: ${target}`);
  exactContent(blob, sha256, s.size);
  const same = statSync(target, { bigint: true }).ino === statSync(blob, { bigint: true }).ino;
  if (s.nlink > 1 && !same) throw Error(`Unowned hardlink must be preserved: ${target}`);
  if (!same) { chmodSync(target, 0o600); unlinkSync(target); return; }
  const marker = permissionMarker(shared);
  atomicStorageJSON(marker, { sha256 });
  try { chmodSync(blob, 0o600); unlinkSync(target); }
  finally { if (existsSync(blob)) chmodSync(blob, 0o400); if (existsSync(marker)) unlinkSync(marker); }
}
export function linkContent(shared, sha256, target) {
  recoverContentPermissions(shared); const blob = contentPath(shared, sha256);
  target = contentTarget(shared, target); exactContent(blob, sha256);
  if (target === blob) return target;
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    exactContent(target, sha256, statSync(blob).size);
    if (statSync(target, { bigint: true }).ino === statSync(blob, { bigint: true }).ino) { chmodSync(blob, 0o400); return target; }
    removeContentLink(shared, target);
  }
  linkSync(blob, target); chmodSync(blob, 0o400); return target;
}
export function shareContentFile(shared, source, expected = null) {
  source = contentTarget(shared, source); recoverContentPermissions(shared);
  const bytes = readFileSync(source), sha256 = contentHash(bytes);
  if (expected && (sha256 !== expected.sha256 || bytes.length !== expected.bytes)) throw Error(`Original changed before sharing: ${source}`);
  const blob = contentPath(shared, sha256); mkdirSync(dirname(blob), { recursive: true });
  if (!existsSync(blob)) { renameSync(source, blob); chmodSync(blob, 0o400); }
  else exactContent(blob, sha256, bytes.length);
  linkContent(shared, sha256, source);
  return { sha256, bytes: bytes.length, path: blob };
}
export function makePrivate(shared, target) {
  target = contentTarget(shared, target); recoverContentPermissions(shared);
  const poolRelative=relative(resolve(storeRoot(shared),blobDirectory(shared)),target);
  if(poolRelative!=='..'&&!poolRelative.startsWith('..'+sep)&&!isAbsolute(poolRelative))throw Error('The immutable pool cannot become a writable working file');
  if (!existsSync(target)) return target;
  const s = lstatSync(target); if (!s.isFile()) throw Error('Expected a plain writable file');
  if (s.nlink === 1) { if(!(s.mode&0o200))chmodSync(target,0o600); return target; }
  const bytes = readFileSync(target), temporary = target + `.${process.pid}.private`;
  let created = false;
  try {
    copyFileSync(target, temporary, 1); created = true; chmodSync(temporary, 0o600);
    if (!readFileSync(temporary).equals(bytes)) throw Error('Independent write copy differs');
    removeContentLink(shared, target); renameSync(temporary, target);
  } finally { if (created && existsSync(temporary)) { chmodSync(temporary, 0o600); unlinkSync(temporary); } }
  return target;
}
export function replaceLibraryFile(shared, target, bytes) {
  target = contentTarget(shared, target); mkdirSync(dirname(target), { recursive: true });
  const temporary = target + `.${process.pid}.pending`;
  let created = false;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' }); created = true;
    if (existsSync(target) && (!(statSync(target).mode & 0o200) || statSync(target).nlink > 1)) removeContentLink(shared, target);
    renameSync(temporary, target);
  } finally { if (created && existsSync(temporary)) unlinkSync(temporary); }
}
