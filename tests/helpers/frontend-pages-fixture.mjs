import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { encodeCountryMesh } from '../../src/rendering/country-mesh-codec.js';
import {UI_VIEWER_SOURCES} from '../../scripts/lib/ui-source-catalog.mjs';
import { buildWorkerAsset } from '../../scripts/lib/worker-assets.mjs';
import {buildFrontendIndex,emitFrontendModule} from '../../scripts/lib/frontend-layout.mjs';

export const put = (root, path, value) => {
  if(path==='index.html')path='src/app/index.html';
  else if(path==='assets/js/viewer.js')path='src/app/viewer.js';
  else if(path==='assets/js/workers/core-viewer-session-worker.js')path='src/document/workers/core-viewer-session-worker.js';
  else if(path.startsWith('assets/js/')&&!path.endsWith('build-meta.js'))path='src/runtime/'+path.slice(10);
  else if(path.startsWith('assets/wasm/')||path.startsWith('assets/fonts/'))path='assets/'+path.slice(7);
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
};
export const run = (command, args, cwd) => spawnSync(command, command === 'git' ? ['-c', 'core.fsync=none', ...args] : args, { cwd, encoding: 'utf8' });

export async function pagesRepositoryFixture(t, { sceneRevision = 6, preparedRevision = 6, previewRevision = 6, canonicalRevision = 6, descriptorRevision = null } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'pando-pages-'));
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root = join(parent, 'source');
  mkdirSync(root);
  assert.equal(run('git', ['init', '-q', root], parent).status, 0);
  assert.equal(run('git', ['config', 'user.name', 'Test'], root).status, 0);
  assert.equal(run('git', ['config', 'user.email', 'test@example.invalid'], root).status, 0);
  put(root, 'index.html', '<h1>Viewer</h1><script src="assets/js/build-meta.js"></script><script type="module" src="assets/js/viewer.js"></script>');
  put(root, 'assets/js/viewer.js', "import '../document/core-document-client.js';");
  put(root,'src/document/core-document-client.js','export const viewerCore = true;');
  put(root, 'assets/js/workers/core-viewer-session-worker.js', '// fixed viewer worker');
  put(root, 'assets/js/app.js', '// editor only');
  put(root,'package.json','{"version":"1.0.0"}');
  put(root,'projects/default-world/manifest.json',readFileSync(new URL('../../projects/default-world/manifest.json',import.meta.url)));
  put(root,'apps/editor/templates/index.html','<h1>Editor</h1><script type="module" src="assets/js/app.js"></script>');
  put(root,'src/rendering/resource-update-policy.js','export const policy=true;');
  // The generated classic Worker policy is compiled from this real runtime owner.
  put(root,'src/runtime/resource-dependency-policy.js',readFileSync(new URL('../../src/runtime/resource-dependency-policy.js',import.meta.url)));
  for(const path of new Set([...UI_VIEWER_SOURCES,'assets/css/app.css','assets/css/viewer.css']))put(root,path.replace('assets/css/','src/ui/css/'),'.fixture { color:red; }');
  put(root, '.nojekyll', '');
  put(root, 'assets/data/terrain-preview/v0.13.3-p2/manifest.json', '{"tiles":{}}');
  put(root, 'assets/data/hydro/v0.13.4/manifest.json', '{"schema":"pandolab-water-shards-v5","version":"0.13.4","container":{"url":"hydro.bin"},"shards":[]}');
  put(root, 'assets/data/hydro/v0.13.4/hydro.bin', 'fixture packfile');
  put(root, 'reports/a.md', 'report');
  put(root, 'native/CMakeLists.txt', 'project(native)');
  put(root, 'tools/build/native/core/CMakeLists.txt', 'project(shared)');
  put(root, 'src/document/native/src/project.cpp', '// native and wasm source');
  put(root, 'apps/editor/src-tauri/src/lib.rs', '// native shell source');
  put(root, 'apps/editor/src-tauri/gen/android/build.gradle.kts', '// Android build');
  put(root, 'assets/js/workers/core-session-worker.js', '// required core worker');
  put(root, 'assets/wasm/pandoeditor-core.js', 'export default function Core() {}');
  put(root, 'assets/wasm/pandoeditor-core.wasm', Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  put(root, 'assets/wasm/pandoeditor-core.manifest.json', '{}');
  /* The frontend builder, rather than this fixture, owns generated Workers. */
  const index=buildFrontendIndex(root);
  const worker = await buildWorkerAsset({root,entry:'assets/js/workers/core-viewer-session-worker.js',readSource:path=>{
    const entry=index.get(path);
    if(!entry)throw Error('Missing Worker fixture: '+path);
    return emitFrontendModule(readFileSync(join(root,entry.sourcePath),'utf8'),entry.sourcePath,index);
  }});
  for (const [path, source] of worker.files) put(root, path, source);
  put(root, 'assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify({ workerAssets: {
    'assets/js/workers/core-viewer-session-worker.js': { url: worker.url, files: [...worker.files.keys()],
      sha256: Object.fromEntries([...worker.files].map(([path, source]) => [path, createHash('sha256').update(source).digest('hex')])) }
  } }) + ');');
  const bytes = Buffer.from('tiny immutable asset'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const assets = {};
  for (const [role, name, extension, encoding] of [
    ['previewCountries', 'countries-preview', '.geojson.gz', 'gzip'],
    ['previewMesh', 'world-mesh-preview', '.bin.gz', 'gzip'],
    ['canonicalCountryPacket', 'countries-canonical', '.pcg.gz', 'gzip'],
    ['canonicalMesh', 'world-mesh', '.bin.gz', 'gzip'],
    ['labelAnchors', 'country-label-anchors', '.json', 'identity'],
    ['preparedCountryScene', 'country-scene', '.bin.gz', 'gzip'],
  ]) {
    const url = 'world/objects/' + name + '-sha256-' + sha256 + extension;
    assets[role] = { url, encoding, sha256, compressedBytes: bytes.length, decodedBytes: 64,
      ...['previewMesh', 'canonicalMesh', 'canonicalCountryPacket'].includes(role) ? { header: [1, 2, 1, 0, 0, 0, 1, sceneRevision] } : {},
      ...role === 'preparedCountryScene' ? { algorithmVersion: sceneRevision, identity: { fills: [['fixture', sha256]], boundaries: [] } } : {} };
    put(root, 'assets/data/' + url, bytes);
  }
  for (const [role, name, revision] of [['previewMesh', 'world-mesh-preview', previewRevision], ['canonicalMesh', 'world-mesh', canonicalRevision]]) {
    const meshBuffer = encodeCountryMesh({ positions: new Int32Array([0,0,1,0,0,1]),
      countryIndices: new Uint16Array([0,0,0]), triangleIndices: new Uint32Array([0,1,2]),
      lineIndices: new Uint32Array([0,1,1,2,2,0]), countryTriangleRanges: new Uint32Array([0,3]),
      countryBoundaryRanges: new Uint32Array([0,6]), countryBounds: new Int32Array([0,0,1,1]),
      countryBoundsFlags: new Uint32Array([1]) }, ['fixture'], 3);
    new Uint32Array(meshBuffer,0,12)[7] = revision;
    const stored = gzipSync(Buffer.from(meshBuffer)), digest = createHash('sha256').update(stored).digest('hex');
    const url = 'world/objects/' + name + '-sha256-' + digest + '.bin.gz';
    const header = [...new Uint32Array(meshBuffer,0,12)];
    if (descriptorRevision !== null) header[7] = descriptorRevision;
    assets[role] = { url, encoding: 'gzip', sha256: digest, compressedBytes: stored.length,
      decodedBytes: meshBuffer.byteLength, header };
    put(root, 'assets/data/' + url, stored);
  }
  put(root,'assets/data/world/current.json',JSON.stringify({schema:'pandolab-world-bundle',schemaVersion:1,
    source:{sha256,countryCount:1,url:'source.json'},defaultClassification:{countries:{}},
    derivation:{preview:'canonical-topology-simplified',coordinateCount:4,meshAlgorithmRevision:sceneRevision},assets}));
  put(root,'assets/data/terrain-preview/v0.13.3-p2/manifest.json',JSON.stringify({sourceDem:{landMaskSha256:'a'.repeat(64)},tiles:{}}));
  const landSource=Buffer.from(JSON.stringify({type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[1,0],[0,0]]]]}));
  const landCompressed=gzipSync(landSource,{level:9,mtime:0});
  const landAsset={url:'assets/data/physical-land/land.bin',encoding:'gzip',
    compressedBytes:landCompressed.length,decodedBytes:landSource.length,
    sha256:createHash('sha256').update(landCompressed).digest('hex')};
  put(root,'assets/data/physical-land/v1/manifest.json',JSON.stringify({schema:'pando-physical-land-v3',sourceSha256:'a'.repeat(64),asset:landAsset}));
  put(root,'assets/data/physical-land/land.bin',landCompressed);
  put(root,'assets/data/places/manifest.json','{"shards":{}}');
  put(root,'assets/data/places/urban-lifetimes-v1.json',JSON.stringify({schema:'pando-place-urban-lifetimes-v1',schemaVersion:1,entries:[]}));
  put(root,'assets/data/territorial-entities/generated/v2/index.json','{"entities":[]}');
  put(root,'assets/data/builtin-world/generated/v1/index.json','{"schema":"pandolab-builtin-world","schemaVersion":2,"storageLayout":"descriptor-geometries-v1","geometryAssets":[],"entities":[]}');
  const identityPath='assets/data/builtin-world/generated/v1/index.json';
  const landPath='assets/data/physical-land/v1/manifest.json';
  const inputHashes=Object.fromEntries([identityPath,landPath].map(path=>[path,
    createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]));
  put(root,'assets/data/prepared-polygons/generated/v2/manifest.json',JSON.stringify({
    schema:'pandolab-prepared-polygon-meshes',schemaVersion:2,algorithmVersion:preparedRevision,meshes:{},inputHashes}));
  const data = join(root, '.library-data/repository');
  mkdirSync(data, { recursive: true });
  run('git', ['init', '-q'], data);
  run('git', ['config', 'user.name', 'Test'], data);
  run('git', ['config', 'user.email', 'test@example.invalid'], data);
  mkdirSync(join(data, 'assets'), { recursive: true });
  renameSync(join(root, 'assets/data'), join(data, 'assets/data'));
  const dataFiles = {};
  function list(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + '/' + entry.name;
      if (entry.isDirectory()) list(join(directory, entry.name), path);
      else { const bytes = readFileSync(join(directory, entry.name)); dataFiles[path] = { stored: path, encoding: 'identity', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
    }
  }
  list(join(data, 'assets/data'), 'assets/data');
  put(data, 'archive/index.json', JSON.stringify({ files: dataFiles }));
  run('git', ['add', '.'], data); run('git', ['commit', '-qm', 'paired data'], data);
  const revision = run('git', ['rev-parse', 'HEAD'], data).stdout.trim();
  put(root, 'config/library-data.json', JSON.stringify({ repository: 'example/library-data', revision, mounts: ['assets/data'] }));
  put(root, '.gitignore', '.library-data/\nassets/data/\n');
  assert.equal(run('git', ['add', '.'], root).status, 0);
  assert.equal(run('git', ['commit', '-q', '-m', 'fixture'], root).status, 0);
  return { parent, root, stage: join(parent, 'site'), manifest: join(parent, 'evidence.json') };
}
