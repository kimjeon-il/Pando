// Private distribution projection. Algorithms remain in the canonical plugin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, statfs } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { collectSourceFiles, readPinnedSource, nodeManifest, writeArtifactFiles, archiveDirectory, analysisAssetCatalog } from './runtime-assets.mjs';
import { bundlePath, verifyRuntimeFiles } from '../../plugins/pando-map-tools/lib/runtime.mjs';
import { frontendWasmRoot } from '../../scripts/lib/frontend-layout.mjs';
import { collectMapImageArtifacts } from '../map-image/native-resample.mjs';
import { collectMapPdfArtifacts } from '../map-image/native-pdf.mjs';
import { collectMapPreviewArtifacts } from '../map-image/native-preview.mjs';

const run=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const prefix='plugins/pando-map-tools/',skill='skills/pando-map-analysis/';

export async function privatePluginEntries({revision,modelPath,workspace=root,version,release,legacyManifest}) {
  if(!/^[a-f0-9]{40}$/.test(revision||''))throw Error('A full source commit is required');
  const read=name=>readPinnedSource(workspace,revision,name);
  const dataset=await analysisAssetCatalog(workspace,{revision});
  const {config,ocrResources,gazetteerResources,gazetteer}=dataset;
  const source=JSON.parse(await read(prefix+'plugin.json')),npm=nodeManifest(workspace);
  const lockDiff=await run('git',['diff','--name-only',revision,'--','pnpm-lock.yaml'],{cwd:workspace});
  assert.equal(lockDiff.stdout.trim(),'','Dependency closure must match the committed lockfile');
  const sourceNpm=JSON.parse(await read('package.json'));
  for(const [name,version]of Object.entries(npm.dependencies))assert.equal(sourceNpm.dependencies?.[name]??sourceNpm.devDependencies?.[name],version,'Installed dependency differs from committed version');
  const entries=[],seed=[];
  const add=(path,bytes)=>entries.push({path,data:bytes});
  const addSeed=(path,bytes)=>{seed.push({path,bytes:bytes.length,sha256:hash(bytes)});add(skill+'runtime/workspace/'+path,bytes);};
  for(const path of await collectSourceFiles(workspace,{revision})) {
    if(path==='package.json')continue;
    if(path.startsWith(prefix)) {
      const name=path.slice(prefix.length);
      if(name.startsWith('skills/pando-map-analysis/'))add(skill+name.slice('skills/pando-map-analysis/'.length),await read(path));
      else if(!name.startsWith('skills/'))add(skill+name,await read(path));
    } else addSeed(path,await read(path));
  }
  for(const entry of collectMapImageArtifacts({workspace,revision}))addSeed(entry.path,entry.data);
  for(const entry of collectMapPdfArtifacts({workspace,revision}))addSeed(entry.path,entry.data);
  for(const entry of collectMapPreviewArtifacts({workspace,revision}))addSeed(entry.path,entry.data);
  addSeed('package.json',json(npm));
  addSeed('docs/historical-border-reconstruction-policy.md',await read('docs/historical-border-reconstruction-policy.md'));
  for(const name of ['pandoeditor-core.manifest.json','pandoeditor-core.js','pandoeditor-core.wasm'])addSeed(frontendWasmRoot+'/'+name,await read(frontendWasmRoot+'/'+name));
  for(const file of dataset.files)addSeed(file.path,file.data);
  modelPath=resolve(modelPath);const modelBytes=await readFile(modelPath),model=JSON.parse(modelBytes);
  if(hash(modelBytes)!==config.defaultModel.manifestSha256||model.model.sha256!==config.defaultModel.sha256)throw Error('Private default model differs from the immutable analysis pairing; candidate analysis is not default-model admission');
  assert.equal(model.trainingOnly,true);assert.equal(model.evaluationStatus,'pending');assert.equal(model.releaseApproved,false);
  await verifyRuntimeFiles(dirname(modelPath),[{path:model.model.url,...model.model}]);
  add(skill+'model/boundary.manifest.json',modelBytes);add(skill+'model/'+model.model.url,await readFile(bundlePath(dirname(modelPath),model.model.url)));
  add(skill+'runtime.json',json({schemaVersion:2,codeRevision:revision,dataRevision:config.revision,files:seed,
    analysisData:{path:'analysis-data.json',bytes:(await read(prefix+'analysis-data.json')).length,sha256:hash(await read(prefix+'analysis-data.json'))},
    model:{path:'model/boundary.manifest.json',bytes:modelBytes.length,sha256:hash(modelBytes)},ocrResources,gazetteerResources,
    gazetteer:{revision:gazetteer.revision,manifestSha256:config.gazetteer.manifestSha256}}));
  const outer=structuredClone(source);outer.name='map-toolkit';outer.version=version||source.version;
  outer.description='Find or attach maps, review georeferencing and boundary candidates, and download GeoJSON in private Work.';
  const ui=outer.extensions['com.openai'].interface;ui.composerIcon='./'+skill+'assets/map-toolkit.svg';ui.logo=ui.composerIcon;
  add('plugin.json',json(outer));
  if(legacyManifest)add('.codex-plugin/plugin.json',json({...legacyManifest,name:outer.name,version:outer.version,description:outer.description,interface:{...legacyManifest.interface,...ui}}));
  if(release)add('release.json',json({...release,version:outer.version}));
  return {entries,version:outer.version,codeRevision:revision,dataRevision:config.revision,modelSha256:model.model.sha256};
}

export function privatePluginFingerprint(entries) {
  const rows=entries.filter(row=>!['release.json','.codex-plugin/plugin.json'].includes(row.path)).map(row=>{
    let bytes=row.data;
    if(row.path.endsWith('plugin.json')){const value=JSON.parse(bytes);delete value.version;bytes=json(value);}
    if(row.path==='skills/pando-map-analysis/runtime.json'){const value=JSON.parse(bytes);delete value.codeRevision;bytes=json(value);}
    return [row.path,hash(bytes)];
  }).sort(([a],[b])=>a.localeCompare(b));
  return hash(JSON.stringify(rows));
}

export async function assertPushedPluginRevision(workspace,revision,{branch='work/ui'}={}){
  if(!/^[a-f0-9]{40}$/.test(revision)||!['work/ui','work/gis'].includes(branch))throw Error('Full revision and supported plugin source branch required');
  await run('git',['merge-base','--is-ancestor',revision,'refs/remotes/origin/'+branch],{cwd:workspace});
}
export async function packagePrivatePlugin({revision,directory,modelPath,workspace=root,version,release,legacyManifest,branch}) {
  await assertPushedPluginRevision(workspace,revision,{branch});
  directory=resolve(directory);const rel=relative(workspace,directory);
  if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw Error('Private package must be outside application Git');
  const candidate=await privatePluginEntries({revision,modelPath,workspace,version,release,legacyManifest}),{entries}=candidate;
  const total=entries.reduce((sum,row)=>sum+row.data.length,0);
  await mkdir(dirname(directory),{recursive:true});const free=await statfs(dirname(directory));
  if(free.bavail*free.bsize<total*3+5*1024**3)throw Error('Private package requires peak size plus 5GiB headroom');
  const files=await writeArtifactFiles(directory,entries);await verifyRuntimeFiles(directory,files);
  // Verify the exact packaged source/WASM pairing without compiling or rebinding it.
  const seedRoot=join(directory,skill,'runtime/workspace');
  const {loadNodeCore}=await import(pathToFileURL(join(seedRoot,'tools/load-node-core.mjs')));await loadNodeCore({root:seedRoot});
  return {...Object.fromEntries(Object.entries(candidate).filter(([key])=>key!=='entries')),files,
    directory,fileCount:files.length,uncompressedBytes:total,...await archiveDirectory(directory)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{revision:{type:'string'},branch:{type:'string'},directory:{type:'string'},model:{type:'string'}}});
  try{console.log(JSON.stringify(await packagePrivatePlugin({revision:values.revision,directory:values.directory,modelPath:values.model,branch:values.branch}),null,2));}
  catch(error){console.error(error);process.exitCode=1;}
}
