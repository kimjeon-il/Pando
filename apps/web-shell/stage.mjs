import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildWorkerAsset } from '../../scripts/lib/worker-assets.mjs';
import { tinyFixture } from './fixture.mjs';
import { installNetworkGuard } from './network-guard.js';
import { loadFullWorldAssetPlan } from './world-data-plan.mjs';
import { referenceAnalysisAssetPlan } from './reference-analysis-plan.mjs';
import { prepareLibraryData } from '../../tools/library-data.mjs';
import { previewFileIdentity } from '../../scripts/p3-preview-server.mjs';
import { writeStagedContent, removeStagedDirectory, storageSettings } from '../../tools/worktree-storage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const ownership = '.pandolab-web-shell-stage';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path => access(path).then(() => true, () => false);
const slash = path => path.replaceAll('\\', '/');

export function validateShellProfile(profile, verification) {
  if (!['test-fixture', 'map-data'].includes(profile)) throw new Error('Unknown shell staging profile.');
  if (profile === 'test-fixture' && verification !== true) throw new Error('The test-fixture profile requires explicit verification.');
}

/** Ordinary app builds always use the real world; fixture staging is verification-only. */
export async function stagePrototype({ root = repository, profile = 'map-data', verification = false } = {}) {
  validateShellProfile(profile, verification);
  const parent = resolve(root, 'apps/web-shell');
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
      if (!await exists(directory)) await rename(previous, directory);
      else removeStagedDirectory({root,directory:previous});
    }
    if (await exists(pending)) removeStagedDirectory({root,directory:pending});
    const result = await stageOwnedPrototype({ root, profile, verification, directory: pending });
    if (await exists(directory)) await rename(directory, previous);
    try { await rename(pending, directory); }
    catch (error) { if (await exists(previous)) await rename(previous, directory); throw error; }
    if (await exists(previous)) removeStagedDirectory({root,directory:previous});
    return { ...result, directory };
  } catch (error) {
    if (await exists(join(pending, ownership))) removeStagedDirectory({root,directory:pending});
    throw error;
  }
  finally { await lock.close(); await unlink(lockPath); }
}

export async function createDevelopmentAssets({ root = repository, profile = 'map-data' } = {}) {
  const assets = new Map();
  const evidence = await stageOwnedPrototype({ root, profile, verification: false, assets, directory: null });
  assets.set('shell/stage-evidence.json', { bytes: Buffer.from(JSON.stringify({ ...evidence, executionMode: 'development' })) });
  return { assets, evidence };
}

async function stageOwnedPrototype({ root, profile, verification, directory, assets = null }) {
  validateShellProfile(profile, verification);
  root = resolve(root);
  const storage = assets ? null : storageSettings(root);
  const generator = join(root, 'scripts/generate-build-metadata.mjs');
  if (await exists(generator)) prepareLibraryData({ root });
  if (!assets && await exists(generator)) execFileSync(process.execPath, [generator, '--check'], { cwd: root, stdio: 'pipe' });
  const buildSource = await readFile(join(root, 'assets/js/build-meta.js'), 'utf8');
  let buildMeta = JSON.parse(buildSource.match(/Object\.freeze\(([\s\S]*)\);\s*$/)?.[1] || '{}');
  const workerFiles = new Set(Object.values(buildMeta.workerAssets || {}).flatMap(asset => asset.files));
  const workerHashes = Object.assign({}, ...Object.values(buildMeta.workerAssets || {}).map(asset => asset.sha256));
  const workerSources = new Map();
  if (assets && await exists(join(root, 'assets/js/workers'))) {
    const workerAssets = {};
    for (const entry of await readdir(join(root, 'assets/js/workers'))) if (entry.endsWith('-worker.js')) {
      const path = 'assets/js/workers/' + entry;
      const generated = await buildWorkerAsset({ root, entry: path });
      workerAssets[path] = { url: generated.url, files: [...generated.files.keys()], sha256: Object.fromEntries([...generated.files].map(([path, bytes]) => [path, hash(bytes)])) };
      for (const [path, bytes] of generated.files) workerSources.set(path, Buffer.from(bytes));
    }
    buildMeta = { ...buildMeta, workerAssets };
    workerFiles.clear(); for (const asset of Object.values(workerAssets)) for (const path of asset.files) workerFiles.add(path);
    Object.assign(workerHashes, ...Object.values(workerAssets).map(asset => asset.sha256));
  }
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
    writeStagedContent({root,directory,path,bytes:Buffer.from(bytes),source,settings:storage});
    }
    files.push({ path: slash(path), bytes: Buffer.byteLength(bytes), sha256: hash(bytes), ...(source ? { source } : {}) });
  };
  async function copyTree(path) {
    if (assets && path === 'assets/worker-runtime') { for (const [path, bytes] of workerSources) await emit(path, bytes); return; }
    if (!await exists(join(root, path))) return;
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic links cannot enter the shell distribution: ${child}`);
      if (entry.isDirectory()) await copyTree(child);
      else if (entry.isFile() && !entry.name.endsWith('.map')) {
        if (slash(child).startsWith('assets/worker-runtime/') && !workerFiles.has(slash(child))) continue;
        let bytes = await readFile(join(root, child));
        if (workerFiles.has(slash(child)) && hash(Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))) !== workerHashes[slash(child)]) throw new Error(`Immutable Worker asset mismatch: ${child}`);
        if (slash(child) === 'assets/js/build-meta.js') {
          if (assets) bytes = Buffer.from('globalThis.PANDOLAB_BUILD_META = Object.freeze(' + JSON.stringify(buildMeta) + ');');
          bytes = Buffer.concat([bytes, Buffer.from(`\nglobalThis.PANDOLAB_BUILD_META = Object.freeze({ ...globalThis.PANDOLAB_BUILD_META, resourceProfile: '${profile}' });\n`)]);
        }
        if (/(?:^|\/)assets\/js\/workers\//.test(slash(child)) && child.endsWith('.js')) {
          const strict = /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*(['"])use strict\1\s*;/.test(bytes.toString('utf8'));
          bytes = Buffer.concat([Buffer.from(`${strict ? "'use strict';\n" : ''}/* Shell-only request guard; original worker follows. */\n(${installNetworkGuard.toString()})(globalThis, { allowBundledData: ${profile === 'map-data'} });\n`), bytes]);
        }
        await emit(child, bytes, slash(child));
      }
    }
  }
  const manifestPath = 'assets/wasm/pandoeditor-core.manifest.json';
  const manifestBytes = await readFile(join(root, manifestPath));
  const coreManifest = JSON.parse(manifestBytes);
  if (coreManifest.schema !== 'pandoeditor-core-wasm' || coreManifest.abiVersion !== 1) throw new Error('Unexpected WASM manifest');
  for (const type of ['js', 'wasm']) {
    const spec = coreManifest.assets?.[type];
    if (spec?.file !== `pandoeditor-core.${type}`) throw new Error('Unexpected WASM asset path');
    const path = `assets/wasm/${spec.file}`, bytes = await readFile(join(root, path));
    if (hash(bytes) !== spec.sha256) throw new Error(`WASM ${type} hash mismatch; regenerate through the existing shared-core owner.`);
    await emit(path, bytes, path);
  }
  await emit(manifestPath, manifestBytes, manifestPath);
  for (const tree of ['assets/js', 'assets/css', 'assets/fonts', 'assets/vendor', 'assets/worker-runtime']) await copyTree(tree);
  const referenceVendorPath = 'assets/vendor/reference-analysis/manifest.json';
  const referenceOcrPath = 'assets/data/reference-analysis/v1/ocr/manifest.json';
  const referenceBoundaryPath = 'assets/data/reference-analysis/v1/boundary.manifest.json';
  const referenceVendor = JSON.parse(await readFile(join(root, referenceVendorPath), 'utf8'));
  const referenceOcr = JSON.parse(await readFile(join(root, referenceOcrPath), 'utf8'));
  const referenceBoundary = await exists(join(root, referenceBoundaryPath)) ? JSON.parse(await readFile(join(root, referenceBoundaryPath), 'utf8')) : null;
  const referencePlan = referenceAnalysisAssetPlan(referenceVendor, referenceOcr, referenceBoundary);
  const referenceDataRoot = await realpath(join(root, 'assets/data/reference-analysis/v1'));
  for (const item of referencePlan.entries) {
    const actual = await realpath(join(root, item.path));
    if (item.path.startsWith('assets/data/') && !actual.startsWith(referenceDataRoot + sep)) throw new Error('Reference data resource escapes its root.');
    const bytes = await readFile(actual);
    if (hash(bytes) !== item.sha256 || bytes.length !== item.bytes) throw new Error(`Reference analysis resource mismatch: ${item.path}`);
    if (item.path.startsWith('assets/data/')) await emit(item.path, bytes, item.path);
  }
  await emit(referenceOcrPath, await readFile(join(root, referenceOcrPath)), referenceOcrPath);
  if (referenceBoundary) await emit(referenceBoundaryPath, await readFile(join(root, referenceBoundaryPath)), referenceBoundaryPath);
  if (buildMeta.physicalLand) await copyTree('assets/data/physical-land');
  const html = await readFile(join(root, 'apps/web-shell/editor.html'), 'utf8');
  const productBase = '<base href="../../" data-product-base="editor" />';
  if (html.split(productBase).length !== 2 || (html.match(/<base\b/g) || []).length !== 1)
    throw new Error('The editor entry requires its explicit product base.');
  const bootstrap = /<script\s+src="assets\/js\/bootstrap\.js[^"]*"\s+defer><\/script>/;
  if (!bootstrap.test(html)) throw new Error('The current frontend bootstrap entry was not found.');
  await emit('index.html', html.replace(productBase, '<base href="./" data-product-base="editor" />')
    .replace(bootstrap, '<script type="module" src="shell/startup.js"></script>'), 'apps/web-shell/editor.html (shell entry only)');
  const shellFiles = ['startup.js', 'runtime-profile.js', 'native-storage.js', 'network-guard.js'];
  if (verification) shellFiles.push('verification.js', 'probe-storage.js', 'diagnostics.js', 'full-world-probe.js', 'reference-analysis-probe.js', 'fixture-limits.js', 'diagnostics.css');
  for (const file of shellFiles) {
    let bytes = await readFile(join(here, file));
    if (file === 'startup.js' && verification) {
      const source = bytes.toString();
      if (!source.includes('const verification = null;')) throw Error('Missing verification staging boundary.');
      bytes = Buffer.from(source.replace('const verification = null;', "import * as verification from './verification.js';"));
    }
    await emit('shell/' + file, bytes, 'apps/web-shell/' + file);
  }
  if (process.env.PANDOLAB_REFERENCE_PROBE_SOURCE) {
    if (!verification || profile !== 'map-data') throw new Error('Reference runtime proof requires a map-data verification build.');
    const bytes = await readFile(process.env.PANDOLAB_REFERENCE_PROBE_SOURCE);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('Native reference probe source exceeds 8 MiB.');
    await emit('shell/reference-probe.jpg', bytes);
    await emit('shell/reference-probe.json', Buffer.from(JSON.stringify({ sha256: hash(bytes), bytes: bytes.length })));
  }
  let fixture = null;
  let fixtureHash = null;
  let worldData = null;
  if (profile === 'test-fixture') {
    fixture = tinyFixture();
    if (await exists(join(root, 'package.json'))) fixture.project.version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
    if (fixture.coordinateCount > 100) throw new Error('Prototype fixture exceeds the 100-coordinate limit');
    fixture.builtinIndex.template.version=fixture.project.version;
    const countryChunks = [];
    let offset = 0;
    for(const country of fixture.builtinCountries){
      const decoded=Buffer.from(JSON.stringify(country)),stored=gzipSync(decoded,{level:9});
      const file=`countries/${country.entityId}-sha256-${hash(stored)}.json.gz`;
      Object.assign(fixture.builtinIndex.entities.find(row=>row.entityId===country.entityId),{file,offset,encoding:'gzip',sha256:hash(stored),compressedBytes:stored.length,decodedBytes:decoded.length});
      countryChunks.push(stored);
      offset += stored.length;
    }
    const transport = Buffer.concat(countryChunks), transportHash = hash(transport);
    const transportUrl = `transport/countries-sha256-${transportHash}.bin`;
    fixture.builtinIndex.transport = { schemaVersion: 1, url: transportUrl, encoding: 'identity', sha256: transportHash,
      compressedBytes: transport.length, decodedBytes: transport.length };
    await emit('shell/' + transportUrl, transport);
    const world=Buffer.from(JSON.stringify(fixture.builtinIndex));fixtureHash=hash(world);
    await emit('shell/fixture-world.json',world);
    await emit('shell/fixture-countries.json',JSON.stringify(fixture.countries));
    const builtinWorld={url:'./fixture-world.json',encoding:'identity',sha256:hash(world),compressedBytes:world.length,decodedBytes:world.length};
    await emit('shell/stage-profile.json',JSON.stringify({mode:profile,verification,builtinWorld,countriesUrl:'./fixture-countries.json'}));
  } else {
     const {plan,meta}=await loadFullWorldAssetPlan(path=>readFile(join(root,path),'utf8'));
   const dataRoot = await realpath(resolve(root, 'assets/data'));
    let packagedBytes = 0;
    for (const item of plan.entries) {
      const actual = await realpath(resolve(root, item.path));
      if (!actual.startsWith(dataRoot + sep) || !(await lstat(actual)).isFile()) {
        throw new Error(`Bundled world resource escapes the repository: ${item.path}`);
      }
      const bytes = await readFile(actual);
      if ((item.bytes != null && bytes.length !== item.bytes)
          || (item.sha256 != null && hash(bytes) !== item.sha256)) {
        throw new Error(`Pinned world resource mismatch: ${item.path}`);
      }
      await emit(item.path, bytes, item.path);
      packagedBytes += bytes.length;
    }
    worldData = { countryCount: plan.countryCount, worldFileCount: plan.worldFileCount,
      physicalFileCount: plan.physicalFileCount, rootCount: plan.rootCount,
      unitCount: plan.unitCount, modelEntityCount: plan.modelEntityCount,
      mergedSourceCount: plan.mergedSourceCount, sourceSha256: plan.sourceSha256,
      fileCount: plan.entries.length, bytes: packagedBytes, dataRevision: meta.dataRevision };
    await emit('shell/stage-profile.json', JSON.stringify({
      mode: profile, verification, assetRevision: meta.assetRevision, dataRevision: meta.dataRevision,
      world: { countryCount: plan.countryCount, rootCount: plan.rootCount,
        worldFileCount: plan.worldFileCount, physicalFileCount: plan.physicalFileCount,
        unitCount: plan.unitCount, modelEntityCount: plan.modelEntityCount,
        mergedSourceCount: plan.mergedSourceCount, sourceSha256: plan.sourceSha256 },
    }));
  }
  let commit = 'unavailable', trackedDiffSha256 = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    trackedDiffSha256 = hash(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }));
  } catch { /* Synthetic staging tests have no Git directory. */ }
  const dataPin = await exists(join(root, 'config/library-data.json')) ? JSON.parse(await readFile(join(root, 'config/library-data.json'), 'utf8')) : null;
  const result = { schema: 'pandolab-web-shell-stage', profile, verification, directory, commit, trackedDiffSha256,
    dataRepository: dataPin?.repository, dataCommit: dataPin?.revision,
    coreSourceSha256: coreManifest.sourceSha256 || null,
    fixture: fixture ? { entityCount: fixture.entityCount, coordinateCount: fixture.coordinateCount, sha256: fixtureHash } : null,
    worldData, referenceAnalysis: { bytes: referencePlan.bytes, modelAvailable: !!referenceBoundary }, files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  const limit = (profile === 'map-data' ? 256 : 80) * 1024 * 1024 + referencePlan.bytes;
  const physicalPaths=new Set([buildMeta.physicalLand?.url,'assets/data/physical-land/v1/manifest.json',
    ...(buildMeta.physicalWaterHistory||[]).flatMap(row=>[row.land.url,row.water.url])]);
  if (result.bytes > limit || (profile === 'test-fixture'
      && files.some(file => file.path.startsWith('assets/data/') && !file.path.startsWith('assets/data/reference-analysis/v1/') && !physicalPaths.has(file.path)))) {
    throw new Error('Shell staging exceeded the selected offline profile');
  }
  if (directory) await writeFile(join(directory, 'shell/stage-evidence.json'), JSON.stringify({ ...result, directory: join(root, 'apps/web-shell/dist') }, null, 2));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const profile = process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length)
    || process.env.PANDOLAB_SHELL_PROFILE || 'map-data';
  const verification = process.argv.includes('--verification') || process.env.PANDOLAB_SHELL_VERIFICATION === '1';
  const result = await stagePrototype({ profile, verification });
  console.log(`Staged ${result.profile}: ${result.files.length} files, ${result.bytes} bytes, ${result.worldData?.countryCount || result.fixture?.entityCount} entities (${result.commit}).`);
}
