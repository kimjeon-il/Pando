import {readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {UI_BUNDLE_SOURCES,UI_MODAL_SOURCES} from '../../../../scripts/lib/ui-source-catalog.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function worldFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'pandolab-full-world-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, value) => {
    if(path==='index.html')path='apps/viewer/templates/index.html';
    else if(path==='apps/editor/editor.html')path='apps/editor/templates/index.html';
    else if(path.startsWith('assets/js/')&&!path.endsWith('build-meta.js'))path='shared/frontend/js/'+path.slice(10);
    else if(path.startsWith('assets/wasm/'))path='shared/frontend/static/wasm/'+path.slice(12);
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), value);
  };
  const pinned = async (path, bytes = Buffer.from('DATA')) => {
    await put(path, bytes);
    return { url: path, sha256: sha(bytes), compressedBytes: bytes.byteLength, decodedBytes: bytes.byteLength };
  };
  await put('index.html', '<html>Viewer only</html>');
  await put('apps/editor/editor.html', '<html><base href="../../" data-product-base="editor" /><script src="assets/js/bootstrap.js?v=test" defer></script></html>');
  await put('assets/js/app.js', 'export const originalWeb = true;');
  await put('assets/js/bootstrap.js', 'globalThis.startedByWebBootstrap = true;');
  const wasmJs = await pinned('assets/wasm/pandoeditor-core.js', Buffer.from('export default ()=>({});'));
  const wasm = await pinned('assets/wasm/pandoeditor-core.wasm', Buffer.from([0, 97, 115, 109]));
  await put('assets/wasm/pandoeditor-core.manifest.json', JSON.stringify({
    schema: 'pandoeditor-core-wasm', abiVersion: 1,
    assets: { js: { file: 'pandoeditor-core.js', sha256: wasmJs.sha256 },
      wasm: { file: 'pandoeditor-core.wasm', sha256: wasm.sha256 } },
  }));
  const worldRoles = ['previewCountries', 'previewMesh', 'canonicalCountryPacket', 'canonicalMesh', 'labelAnchors'];
  const world = { schema: 'pandolab-world-bundle', schemaVersion: 1,
    source: { countryCount: 258, sha256: 'a'.repeat(64) },
    assets: {}, compatibility: { sharedBoundaries: {} },
  };
  for (const role of worldRoles) {
    const data = Buffer.from(role);
    const path = 'assets/data/world/objects/' + role + '-sha256-' + sha(data) + '.bin.gz';
    world.assets[role] = { ...await pinned(path, data), url: path.slice('assets/data/'.length) };
  }
  world.defaultClassification = {
    countries: Object.fromEntries(Array.from({ length: 207 }, (_, i) => ['root-' + i, 'source'])),
    units: Object.fromEntries(Array.from({ length: 47 }, (_, i) => ['unit-' + i, { parentId: 'root-0' }])),
    removedIds: Array.from({ length: 51 }, (_, i) => 'removed-' + i),
  };
  for (const role of ['preview', 'canonical']) {
    const name = 'countries-' + role + '-shared-v0.36.1.json.gz';
    await put('assets/data/' + name, 'SHARED');
    world.compatibility.sharedBoundaries[role] = name;
  }
  await put('assets/data/world/current.json', JSON.stringify(world));
  const country=await pinned('assets/data/builtin-world/generated/v1/countries/state-ABC-sha256-'+sha(Buffer.from('COUNTRY'))+'.json.gz',Buffer.from('COUNTRY'));
  const historicPath='assets/data/builtin-world/generated/v1/index.json';
  const transport=await pinned('assets/data/builtin-world/generated/v1/transport/countries-sha256-'+country.sha256+'.bin',Buffer.from('COUNTRY'));
  const historicSpec=await pinned(historicPath,Buffer.from(JSON.stringify({schema:'pandolab-builtin-world',schemaVersion:2,
    transport:{...transport,url:transport.url.split('/v1/')[1],schemaVersion:1,encoding:'identity'},
    entities:[{...country,file:country.url.split('/v1/')[1],offset:0}]})));
  const libPath = 'assets/data/territorial-entities/generated/v2/';
  const libraryChunk = await pinned(libPath + 'state-ABC.json.gz');
  const indexSpec = await pinned(libPath + 'index.json', Buffer.from(JSON.stringify({
    schemaVersion: 2, entities: [{ file: 'state-ABC.json.gz',
      sha256: libraryChunk.sha256, compressedBytes: libraryChunk.compressedBytes }],
  })));
  const prepPath = 'assets/data/prepared-polygons/generated/v2/';
  const data = Buffer.from('PREPARED');
  const mesh = await pinned(prepPath + 'polygon-mesh-sha256-' + sha(data) + '.bin.gz', data);
  const prepSpec = await pinned(prepPath + 'manifest.json', Buffer.from(JSON.stringify({
    schemaVersion: 2, meshes: { key: mesh },
  })));
  const terrain = {
    version: '0.13.3-p2', representation: 'raster-rgba-v1',
    urlTemplate: 'terrain-preview/v0.13.3-p2/{level}/{column}-{row}.webp',
    tiles: {},
  };
  const tiles = ['0/0-0.webp','0/1-0.webp','1/0-0.webp','1/1-0.webp','1/2-0.webp',
    '1/0-1.webp','1/1-1.webp','1/2-1.webp'];
  for (const tile of tiles) {
    const path = 'assets/data/terrain-preview/v0.13.3-p2/' + tile;
    const bytes = Buffer.from(tile);
    terrain.tiles[tile] = { sha256: (await pinned(path, bytes)).sha256, bytes: bytes.length };
  }
  await put('assets/data/terrain-preview/v0.13.3-p2/manifest.json', JSON.stringify(terrain));
  const hydroBin = await pinned('assets/data/hydro/v0.13.2/hydro.bin', Buffer.from('HYDRO'));
  await put('assets/data/hydro/v0.13.2/manifest.json', JSON.stringify({
    version: '0.13.2', schema: 'pandolab-water-shards-v5',shards:[],
    container: { url: 'hydro.bin', sha256: hydroBin.sha256, bytes: hydroBin.compressedBytes },
    stats: { compressedBytes: hydroBin.compressedBytes },
  }));
  const placeBin = await pinned('assets/data/places/places-v1.bin', Buffer.from('PLACES'));
  await put('assets/data/places/manifest.json', JSON.stringify({
    version: 1, revision: 'test', shards: {
      'places-v1': { url: 'places-v1.bin', sha256: placeBin.sha256, bytes: placeBin.compressedBytes },
    },
  }));
  const meta = { appVersion: '0.36.0', assetRevision: 'test-full-world', dataRevision: 'data-' + 'b'.repeat(32),
    builtinWorld: historicSpec, territorialIndex: indexSpec, preparedPolygonMeshes: prepSpec };
  await put('assets/js/build-meta.js', 'globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify(meta) + ');\n');
  await put('apps/viewer/js/viewer.js','export const viewer=true;');
  await put('apps/editor/src-tauri/tauri.conf.json',JSON.stringify({app:{security:{csp:"script-src 'self'"}}}));
  await put('package.json','{"version":"0.36.0"}');
  await put('shared/frontend/js/modules/resource-update-policy.js','export const policy=true;');
  for(const path of new Set([...UI_BUNDLE_SOURCES,...UI_MODAL_SOURCES,'assets/css/app.css','assets/css/viewer.css']))await put(path.replace('assets/css/','shared/frontend/css/'),'.fixture { color:red; }');
  terrain.sourceDem={landMaskSha256:'fixture-land'};
  await put('assets/data/terrain-preview/v0.13.3-p2/manifest.json',JSON.stringify(terrain));
  const land=await pinned('assets/data/physical-land/v1/fixture-land.bin',Buffer.from('LAND'));
  await put('assets/data/physical-land/v1/manifest.json',JSON.stringify({sourceSha256:'fixture-land',asset:land}));
  const library=join(root,'.library-data/repository');
  const git=(dir,...args)=>execFileSync('git',['-c','core.fsync=none','-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:dir,encoding:'utf8',stdio:'pipe'}).trim();
  async function pinData(){const entries={};
    const scan=directory=>{for(const e of readdirSync(join(root,directory),{withFileTypes:true})){const path=directory+'/'+e.name;if(e.isDirectory())scan(path);else{const bytes=readFileSync(join(root,path));entries[path]={stored:path,encoding:'identity',bytes:bytes.length,sha256:sha(bytes)};}}};scan('assets/data');
    for(const path of Object.keys(entries))await put('.library-data/repository/'+path,readFileSync(join(root,path)));
    await put('.library-data/repository/archive/index.json',JSON.stringify({files:entries}));
    git(library,'init','-q');git(library,'add','.');git(library,'commit','--allow-empty','-qm','fixture');
    await put('config/library-data.json',JSON.stringify({repository:'test/library',revision:git(library,'rev-parse','HEAD'),mounts:['assets/data']}));
  }
  await pinData();
  git(root,'init','-q');git(root,'add','package.json');git(root,'commit','-qm','fixture');
  return { root, put, mesh, transport, pinData };
}
