import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {finalizeBuiltinWorldFiles} from '../../tools/builtin-country-bytes.mjs';
import { tinyFixture } from './fixture.mjs';
import { guardWorkerSource } from './network-guard.js';
import {summarizeViewerWorldData} from './world-data-plan.mjs';
import { previewFileIdentity } from '../../scripts/p3-preview-server.mjs';
import { writeStagedContent, removeStagedDirectory, storageSettings, editorStageRoot } from '../../tools/worktree-storage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const ownership = '.pandolab-web-shell-stage';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => access(path).then(() => true, () => false);
const slash = path => path.replaceAll('\\', '/');
export async function renameStageDirectory(source,target,{operation=rename,delay=ms=>new Promise(yes=>setTimeout(yes,ms))}={}){
  for(let attempt=0;;attempt++){
    try{return await operation(source,target);}
    catch(error){if(attempt===5||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await delay(100*(attempt+1));}
  }
}

export function validateShellProfile(profile, verification) {
  if (!['test-fixture', 'map-data'].includes(profile)) throw new Error('Unknown shell staging profile.');
  if (profile === 'test-fixture' && verification !== true) throw new Error('The test-fixture profile requires explicit verification.');
}

/** Ordinary app builds always use the real world; fixture staging is verification-only. */
export async function stagePrototype({ root = repository, profile = 'map-data', verification = false, windowsReview = true } = {}) {
  validateShellProfile(profile, verification);
  const parent = editorStageRoot(root);
  await mkdir(parent, { recursive: true });
  const lockPath = join(parent, '.stage-lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Shell staging is already running; wait for the current build.', { cause: error });
    throw error;
  }
  const directory = join(parent, 'dist'), pending = join(parent, '.dist-pending'), previous = join(parent, '.dist-previous');
  try {
    for (const path of [directory, pending, previous]) if (await exists(path) && !await exists(join(path, ownership))) throw new Error('Output directory ownership is not established; no files removed.');
    if (await exists(previous)) {
      if (!await exists(directory)) await renameStageDirectory(previous, directory);
      else removeStagedDirectory({root,directory:previous});
    }
    if (await exists(pending)) removeStagedDirectory({root,directory:pending});
    const result = await stageOwnedPrototype({ root, profile, verification, windowsReview, directory: pending });
    if (await exists(directory)) await renameStageDirectory(directory, previous);
    try { await renameStageDirectory(pending, directory); }
    catch (error) { if (await exists(previous)) await renameStageDirectory(previous, directory); throw error; }
    if (await exists(previous)) removeStagedDirectory({root,directory:previous});
    return { ...result, directory };
  } catch (error) {
    if (await exists(join(pending, ownership))) removeStagedDirectory({root,directory:pending});
    throw error;
  }
  finally { await lock.close(); await unlink(lockPath); }
}

export async function createDevelopmentAssets({ root = repository, profile = 'map-data', windowsReview = true } = {}) {
  const assets = new Map();
  const evidence = await stageOwnedPrototype({ root, profile, verification: false, windowsReview, assets, directory: null });
  assets.set('shell/stage-evidence.json', { bytes: Buffer.from(JSON.stringify({ ...evidence, executionMode: 'development' })) });
  return { assets, evidence };
}

async function stageOwnedPrototype({ root, profile, verification, windowsReview = true, directory, assets = null }) {
  validateShellProfile(profile, verification);
  if(windowsReview!==true)throw Error('Legacy graphical editor staging is retired: Windows reviewer only.');
  root = resolve(root);
  const storage = assets ? null : storageSettings(root);
  const snapshot = await buildFrontendSnapshot({root,resourceProfile:profile,workerSourceTransform:(_path,source)=>guardWorkerSource(source,{allowBundledData:profile==='map-data'})});
  const buildMeta = snapshot.buildMeta;
  if (directory) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, ownership), 'PandoLab web-shell generated files only\n');
  }
  const files = [];
  const emit = async (path, bytes, source = null) => {
    if (assets) {
      let direct = false, file, identity;
      // WASM/glue and manifests are mutable build inputs. Keep their last valid
      // bytes so an incomplete rebuild cannot invalidate the published graph.
      if (source === slash(path) && !slash(path).startsWith('assets/wasm/') && !path.endsWith('.json') && await exists(join(root, source))) {
        file = await realpath(join(root, source));
        const before = previewFileIdentity(await lstat(file, { bigint: true }));
        direct = Buffer.from(bytes).equals(await readFile(file));
        identity = previewFileIdentity(await lstat(file, { bigint: true }));
        direct &&= before === identity;
      }
      assets.set(slash(path), direct ? { file, identity } : { bytes: Buffer.from(bytes) });
    } else {
    const target = resolve(directory, path);
    if (!target.startsWith(directory + '\\') && !target.startsWith(directory + '/')) throw new Error(`Unsafe staged path: ${path}`);
    await mkdir(dirname(target), { recursive: true });
    writeStagedContent({root,directory,path,bytes:Buffer.from(bytes),settings:storage});
    }
    files.push({ path: slash(path), bytes: Buffer.byteLength(bytes), sha256: hash(bytes), ...(source ? { sourcePath:source } : {}) });
  };
  const manifestPath = 'assets/wasm/pandoeditor-core.manifest.json';
  const manifestBytes = snapshot.assets.get(manifestPath).bytes;
  const coreManifest = JSON.parse(manifestBytes);
  if (coreManifest.schema !== 'pandoeditor-core-wasm' || coreManifest.abiVersion !== 1) throw new Error('Unexpected WASM manifest');
  for (const type of ['js', 'wasm']) {
    const spec = coreManifest.assets?.[type];
    if (spec?.file !== `pandoeditor-core.${type}`) throw new Error('Unexpected WASM asset path');
    const path = `assets/wasm/${spec.file}`, bytes = snapshot.assets.get(path).bytes;
    if (hash(bytes) !== spec.sha256) throw new Error(`WASM ${type} hash mismatch; regenerate through the existing shared-core owner.`);
    await emit(path, bytes, snapshot.assets.get(path).sourcePath);
  }
  await emit(manifestPath, manifestBytes, snapshot.assets.get(manifestPath).sourcePath);
  for(const [path,entry] of snapshot.assets) {
    if(path==='index.html'||path==='.nojekyll'||path.startsWith('shell/')||path.startsWith('assets/wasm/')
      ||entry.product==='editor'||!snapshot.viewerPaths.has(path))continue;
    if(profile==='test-fixture'&&path.startsWith('assets/data/'))continue;
    let bytes=entry.bytes;
    await emit(path,bytes,entry.sourcePath);
  }
  // E6: only the reviewed Web product is published into Windows. The legacy
  // editor bootstrap, mutation handlers and modal/vertex assets are excluded.
  if(profile!=='map-data'&&!verification)
    throw Error('Windows reviewer fixture requires explicit verification.');
  let reviewer=snapshot.html.viewer;
  if(!reviewer.includes('assets/js/viewer.js')||!reviewer.includes('id="reviewPanel"'))
    throw Error('The canonical E4 reviewer entrypoint is unavailable.');
  await emit('index.html', reviewer, 'apps/viewer/templates/index.html');
  reviewer=reviewer.replace('<title>판도연구소</title>','<title>판도연구소 — 검수기</title>');
  if(verification){
    if(!reviewer.includes('</body>'))throw Error('Windows review verification requires complete HTML.');
    reviewer=reviewer.replace('</body>','<script type="module" src="shell/review-probe.js"></script>\\n</body>');
  }
  await emit('review.html',reviewer,'apps/viewer/templates/index.html');
  if(verification)await emit('shell/review-probe.js',await readFile(join(here,'review-probe.js')),
    'apps/editor/review-probe.js');
  let fixture = null;
  let fixtureHash = null;
  let worldData = null;
  if (profile === 'test-fixture') {
    fixture = tinyFixture();
    if (await exists(join(root, 'package.json'))) fixture.project.version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
    if (fixture.coordinateCount > 100) throw new Error('Prototype fixture exceeds the 100-coordinate limit');
    fixture.builtinIndex.template.version=fixture.project.version;
    const countryFiles=new Map();
    for(const country of fixture.builtinCountries){
      const decoded=Buffer.from(JSON.stringify(country)),stored=gzipSync(decoded,{level:9});stored[9]=3;
      const file=`countries/${country.entityId.replaceAll(':','-')}-sha256-${hash(stored)}.json.gz`;
      Object.assign(fixture.builtinIndex.entities.find(row=>row.entityId===country.entityId),{file,encoding:'gzip',sha256:hash(stored),compressedBytes:stored.length,decodedBytes:decoded.length});
      countryFiles.set(file,stored);
    }
    finalizeBuiltinWorldFiles(fixture.builtinIndex,countryFiles);
    for(const [file,bytes] of countryFiles)if(file!=='index.json')await emit('shell/'+file,bytes);
    const world=countryFiles.get('index.json');fixtureHash=hash(world);
    await emit('shell/fixture-world.json',world);
    await emit('shell/fixture-countries.json',JSON.stringify(fixture.countries));
    const builtinWorld={url:'./fixture-world.json',encoding:'identity',sha256:hash(world),compressedBytes:world.length,decodedBytes:world.length};
    await emit('shell/stage-profile.json',JSON.stringify({mode:profile,verification,builtinWorld,countriesUrl:'./fixture-countries.json'}));
  } else {
    const dataPaths=[...snapshot.viewerPaths].filter(path=>path.startsWith('assets/data/')).sort();
    const dataRoot = await realpath(resolve(root, 'assets/data'));
    let packagedBytes=0;
    for(const path of dataPaths){
      if(snapshot.assets.has(path)){packagedBytes+=snapshot.assets.get(path).bytes.length;continue;}
      const actual=await realpath(resolve(root,path));
      if(!actual.startsWith(dataRoot+sep)||!(await lstat(actual)).isFile())throw Error(`Bundled world resource escapes the repository: ${path}`);
      const bytes=await readFile(actual),pinned=snapshot.readPinnedRuntimeAsset(path);
      if(!bytes.equals(pinned))throw Error(`Pinned world resource mismatch: ${path}`);
      await emit(path,bytes,path);packagedBytes+=bytes.length;
    }
    const world=JSON.parse(snapshot.readPinnedRuntimeAsset('assets/data/world/current.json'));
    worldData=summarizeViewerWorldData({world,paths:dataPaths,bytes:packagedBytes,dataRevision:snapshot.dataRevision});
    await emit('shell/stage-profile.json', JSON.stringify({
      mode: profile, verification, assetRevision: buildMeta.assetRevision, dataRevision: buildMeta.dataRevision,
      world: { countryCount: worldData.countryCount, rootCount: worldData.rootCount,
        worldFileCount: worldData.worldFileCount, physicalFileCount: worldData.physicalFileCount,
        unitCount: worldData.unitCount, modelEntityCount: worldData.modelEntityCount,
        mergedSourceCount: worldData.mergedSourceCount, sourceSha256: worldData.sourceSha256 },
    }));
  }
  let commit = 'unavailable', trackedDiffSha256 = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    trackedDiffSha256 = hash(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore','pipe','pipe'] }));
  } catch { /* Synthetic staging tests have no Git directory. */ }
  const dataPin = await exists(join(root, 'config/library-data.json')) ? JSON.parse(await readFile(join(root, 'config/library-data.json'), 'utf8')) : null;
  const result = { schema: 'pandolab-web-shell-stage', frontendInputSha256:snapshot.sourceSha256, dataRevision:snapshot.dataRevision, profile, verification, nativeEntry:'review.html', directory, commit, trackedDiffSha256,
    dataRepository: dataPin?.repository, dataCommit: dataPin?.revision,
    coreSourceSha256: coreManifest.sourceSha256 || null,
    fixture: fixture ? { entityCount: fixture.entityCount, coordinateCount: fixture.coordinateCount, sha256: fixtureHash } : null,
    worldData, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  const limit = (profile === 'map-data' ? 256 : 80) * 1024 * 1024;
  const physicalPaths=new Set([buildMeta.physicalLand?.url,'assets/data/physical-land/v1/manifest.json',
    ...(buildMeta.physicalWaterObjects?.geometries||[]).flatMap(row=>[row.land.url,row.asset.url])]);
  if (result.bytes > limit || (profile === 'test-fixture'
      && files.some(file => file.path.startsWith('assets/data/') && !physicalPaths.has(file.path)))) {
    throw new Error('Shell staging exceeded the selected offline profile');
  }
  if (directory) await writeFile(join(directory, 'shell/stage-evidence.json'), JSON.stringify({ ...result, directory: join(editorStageRoot(root),'dist') }, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length)
    || process.env.PANDOLAB_SHELL_PROFILE || 'map-data';
  const verification = process.argv.includes('--verification') || process.env.PANDOLAB_SHELL_VERIFICATION === '1';
  const windowsReview = true; // No native editor or Android product remains.
  const result = await stagePrototype({ profile, verification, windowsReview });
  console.log(`Staged ${result.profile}: ${result.files.length} files, ${result.bytes} bytes, ${result.worldData?.countryCount || result.fixture?.entityCount} entities (${result.commit}).`);
}
