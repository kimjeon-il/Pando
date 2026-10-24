import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8'));
const RELEASE_ASSETS = Object.freeze({
  territorialIndex: 'territorial-entities/generated/v2/index.json',
  builtinWorld: 'builtin-world/generated/v1/index.json',
  preparedPolygonMeshes: 'prepared-polygons/generated/v2/manifest.json',
  worldBundle: 'world/current.json',
});

function relativeDataPath(url) {
  if (typeof url !== 'string') throw new Error('Missing data asset URL');
  const value = url.startsWith('assets/data/') ? url.slice('assets/data/'.length) : url;
  if (!value || value.startsWith('/') || value.includes('\\') || value.includes('?')
    || value.includes('#') || posix.normalize(value) !== value
    || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe publication asset URL: ${url}`);
  }
  return value;
}

function spec(url, bytes) {
  return { url, sha256: sha256(bytes), encoding: 'identity',
    compressedBytes: bytes.length, decodedBytes: bytes.length };
}

export function assembleLibraryRelease({ root, output, revision, sourceRevision }) {
  if (!root || !output || !HEX64.test(revision) || !HEX40.test(sourceRevision)
    || existsSync(output)) throw new Error('Fresh release output and pinned revisions are required');
  const sourceRoot = join(root, 'assets/data');
  const releaseRoot = join(output, 'assets/data/library-releases', revision);
  const releasePrefix = `assets/data/library-releases/${revision}/`;
  const files = {};
  const copy = (url, expectedHash = null) => {
    const path = relativeDataPath(url);
    const source = join(sourceRoot, path);
    if (!existsSync(source)) throw new Error(`Missing publication asset: ${path}`);
    const bytes = readFileSync(source);
    if (expectedHash && (!HEX64.test(expectedHash) || sha256(bytes) !== expectedHash)) {
      throw new Error(`Publication asset SHA-256 mismatch: ${path}`);
    }
    const target = join(releaseRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    files[path] = sha256(bytes);
    return bytes;
  };
  const replace = (path, value) => {
    const target = join(releaseRoot, path);
    const bytes = Buffer.from(JSON.stringify(value) + '\n');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    files[path] = sha256(bytes);
    return bytes;
  };
  const index = json(copy(RELEASE_ASSETS.territorialIndex));
  if (index.schemaVersion !== 2 || !Array.isArray(index.entities)) throw new Error('Invalid publication territorial index');
  for (const entry of index.entities) copy(`territorial-entities/generated/v2/${relativeDataPath(entry.file)}`, entry.sha256);

  const historical = json(copy(RELEASE_ASSETS.builtinWorld));
  if (historical.schema !== 'pandolab-builtin-world' || historical.schemaVersion !== 2 || !Array.isArray(historical.entities)) throw new Error('Invalid publication builtin world');
  for(const entry of historical.entities)copy(`builtin-world/generated/v1/${relativeDataPath(entry.file)}`,entry.sha256);
  copy(`builtin-world/generated/v1/${relativeDataPath(historical.transport.url)}`,historical.transport.sha256);

  const world = json(copy(RELEASE_ASSETS.worldBundle));
  if (world.schema !== 'pandolab-world-bundle' || world.schemaVersion !== 1
    || !Number.isSafeInteger(world.source?.countryCount) || world.source.countryCount <= 0) {
    throw new Error('Invalid publication world bundle');
  }
  copy(world.source.url, world.source.sha256);
  for (const asset of Object.values(world.assets || {})) copy(asset.url, asset.sha256);
  for (const url of Object.values(world.compatibility?.sharedBoundaries || {})) if (url) copy(url);

  const prepared = json(copy(RELEASE_ASSETS.preparedPolygonMeshes));
  if (prepared.schemaVersion !== 2 || !prepared.meshes || typeof prepared.meshes !== 'object') {
    throw new Error('Invalid publication prepared polygon manifest');
  }
  for (const mesh of Object.values(prepared.meshes)) {
    const path = relativeDataPath(mesh.url);
    copy(path, mesh.sha256);
    mesh.url = releasePrefix + path;
  }
  replace(RELEASE_ASSETS.preparedPolygonMeshes, prepared);

  const assets = Object.fromEntries(Object.entries(RELEASE_ASSETS).map(([role, path]) => {
    const bytes = readFileSync(join(releaseRoot, path));
    return [role, spec(releasePrefix + path, bytes)];
  }));
  if (!HEX64.test(prepared.algorithmSourceSha256)) throw new Error('Prepared polygon algorithm source is not pinned');
  assets.preparedPolygonMeshes.algorithmSourceSha256 = prepared.algorithmSourceSha256;
  const manifest = { schema: 'pandolab-library-release', schemaVersion: 1,
    revision, sourceRevision, assets, files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest) + '\n');
  const manifestPath = join(releaseRoot, 'manifest.json');
  writeFileSync(manifestPath, manifestBytes);
  for (const [path, digest] of Object.entries(files)) {
    if (sha256(readFileSync(join(releaseRoot, path))) !== digest) throw new Error(`Staged release mismatch: ${path}`);
  }
  const pointer = { schema: 'pandolab-data-channel', schemaVersion: 1,
    revision, manifestSha256: sha256(manifestBytes) };
  const pointerPath = join(output, 'assets/data/library-channel/current.json');
  mkdirSync(dirname(pointerPath), { recursive: true });
  writeFileSync(pointerPath, JSON.stringify(pointer) + '\n');
  return { manifest, pointer, fileCount: Object.keys(files).length };
}

export function verifyLibraryRelease({ output, revision, checkPointer = true }) {
  if (!HEX64.test(revision)) throw new Error('Invalid release revision');
  const releaseRoot = join(output, 'assets/data/library-releases', revision);
  const manifestBytes = readFileSync(join(releaseRoot, 'manifest.json'));
  const manifest = json(manifestBytes);
  const pointer = checkPointer
    ? json(readFileSync(join(output, 'assets/data/library-channel/current.json'))) : null;
  if (manifest.schema !== 'pandolab-library-release' || manifest.revision !== revision
    || (checkPointer && (pointer.schema !== 'pandolab-data-channel' || pointer.schemaVersion !== 1
      || pointer.revision !== revision || pointer.manifestSha256 !== sha256(manifestBytes)))) {
    throw new Error('Release activation pointer does not match verified manifest');
  }
  for (const [path, digest] of Object.entries(manifest.files)) {
    if (relativeDataPath(path) !== path || sha256(readFileSync(join(releaseRoot, path))) !== digest) {
      throw new Error(`Release asset verification failed: ${path}`);
    }
  }
  const expected = new Set(['manifest.json', ...Object.keys(manifest.files)]);
  const visit = (folder, prefix = '') => {
    for (const name of readdirSync(folder)) {
      const path = prefix ? `${prefix}/${name}` : name;
      const absolute = join(folder, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute, path);
      else if (!stat.isFile() || !expected.delete(path)) throw new Error(`Unlisted release file: ${path}`);
    }
  };
  visit(releaseRoot);
  if (expected.size) throw new Error(`Missing release file: ${[...expected][0]}`);
  for (const [role, asset] of Object.entries(manifest.assets)) {
    const expectedPath = RELEASE_ASSETS[role];
    if (!expectedPath || asset.url !== `assets/data/library-releases/${revision}/${expectedPath}`) {
      throw new Error(`Asset URL escapes immutable release: ${role}`);
    }
    const path = expectedPath;
    const bytes = readFileSync(join(releaseRoot, path));
    if (sha256(bytes) !== asset.sha256 || bytes.length !== asset.compressedBytes
      || manifest.files[path] !== asset.sha256) {
      throw new Error(`Release manifest asset verification failed: ${path}`);
    }
  }
  if (Object.keys(manifest.assets).length !== Object.keys(RELEASE_ASSETS).length) {
    throw new Error('Release manifest is missing a required asset role');
  }
  return { revision, fileCount: Object.keys(manifest.files).length };
}

export function verifyLibraryReleaseArchive({ output }) {
  const pointer = json(readFileSync(join(output, 'assets/data/library-channel/current.json')));
  if (!HEX64.test(pointer?.revision)) throw new Error('Invalid release archive activation pointer');
  const archive = join(output, 'assets/data/library-releases');
  const revisions = readdirSync(archive);
  if (!revisions.includes(pointer.revision)) throw new Error('Active release is missing from archive');
  for (const revision of revisions) {
    if (!HEX64.test(revision) || !lstatSync(join(archive, revision)).isDirectory()) {
      throw new Error(`Invalid release archive entry: ${revision}`);
    }
    verifyLibraryRelease({ output, revision, checkPointer: revision === pointer.revision });
  }
  return { activeRevision: pointer.revision, releaseCount: revisions.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => {
    const at = process.argv.indexOf(name);
    return at < 0 ? null : process.argv[at + 1];
  };
  const output = arg('--output');
  const revision = process.argv.includes('--verify-current')
    ? json(readFileSync(join(output, 'assets/data/library-channel/current.json'))).revision
    : arg('--revision');
  if (process.argv.includes('--verify-archive')) console.log(JSON.stringify(verifyLibraryReleaseArchive({ output })));
  else if (process.argv.includes('--verify') || process.argv.includes('--verify-current')) console.log(JSON.stringify(verifyLibraryRelease({ output, revision })));
  else console.log(JSON.stringify(assembleLibraryRelease({ root: arg('--root'), output,
    revision, sourceRevision: arg('--source-revision') })));
}
