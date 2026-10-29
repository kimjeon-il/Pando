// Private distribution projection. Algorithms remain in the canonical plugin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, statfs } from 'node:fs/promises';
import { resolve, dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { collectSourceFiles, readPinnedSource, nodeManifest, writeArtifactFiles, archiveDirectory } from './runtime-assets.mjs';
import { bundlePath, verifyRuntimeFiles } from '../../plugins/pando-map-tools/lib/runtime.mjs';
import { libraryCheckout, decodeArchiveEntry } from '../library-data.mjs';
import { frontendWasmRoot } from '../../scripts/lib/frontend-layout.mjs';

const run=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const prefix='plugins/pando-map-tools/',skill='skills/pando-map-analysis/';

export async function packagePrivatePlugin({revision,directory,modelPath,workspace=root,python=join(root,'build-native/python/Scripts/python.exe')}) {
  if(!/^[a-f0-9]{40}$/.test(revision||''))throw Error('A full pushed work/ui source commit is required');
  await run('git',['merge-base','--is-ancestor',revision,'origin/work/ui'],{cwd:workspace});
  directory=resolve(directory);const rel=relative(workspace,directory);
  if(!rel||(!rel.startsWith('..')&&!isAbsolute(rel)))throw Error('Private package must be outside application Git');
  const read=name=>readPinnedSource(workspace,revision,name);
  const config=JSON.parse(await read('config/library-data.json')),checkout=libraryCheckout(workspace);
  const index=JSON.parse((await run('git',['show',config.revision+':archive/index.json'],{cwd:checkout,maxBuffer:32*1024*1024})).stdout);
  const data=name=>{
    const entry=index.files[name];if(!entry)throw Error('Pinned data is missing: '+name);
    return decodeArchiveEntry(checkout,entry,config.revision);
  };
  const source=JSON.parse(await read(prefix+'plugin.json')),npm=nodeManifest(workspace);
  assert.equal(hash(await readFile(join(workspace,'pnpm-lock.yaml'))),hash(await read('pnpm-lock.yaml')),'Dependency closure must match the committed lockfile');
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
  addSeed('package.json',json(npm));
  addSeed('docs/historical-border-reconstruction-policy.md',await read('docs/historical-border-reconstruction-policy.md'));
  for(const name of ['pandoeditor-core.manifest.json','pandoeditor-core.js','pandoeditor-core.wasm'])addSeed(frontendWasmRoot+'/'+name,await read(frontendWasmRoot+'/'+name));
  const ocrPath='assets/data/reference-analysis/v1/ocr/',ocr=JSON.parse(data(ocrPath+'manifest.json')),ocrResources={};
  addSeed(ocrPath+'manifest.json',data(ocrPath+'manifest.json'));
  for(const [language,spec]of Object.entries(ocr.languages)) {
    const path=ocrPath+spec.url,entry=index.files[path];if(!entry)throw Error('Pinned OCR language missing: '+language);
    bundlePath(workspace,entry.stored);
    ocrResources[language]={url:'https://raw.githubusercontent.com/'+config.repository+'/'+config.revision+'/'+entry.stored,
      encoding:entry.encoding,bytes:entry.bytes,sha256:entry.sha256};
    assert.equal(entry.sha256,spec.sha256);assert.equal(entry.bytes,spec.bytes);
    if(['eng','osd'].includes(language))addSeed(path,data(path));
  }
  const placesPath='assets/data/places/',places=JSON.parse(data(placesPath+'manifest.json'));
  addSeed(placesPath+'manifest.json',data(placesPath+'manifest.json'));
  for(const spec of Object.values(places.shards)){bundlePath(workspace,spec.url);addSeed(placesPath+spec.url,data(placesPath+spec.url));}
  modelPath=resolve(modelPath);const modelBytes=await readFile(modelPath),model=JSON.parse(modelBytes);
  assert.equal(model.trainingOnly,true);assert.equal(model.evaluationStatus,'pending');assert.equal(model.releaseApproved,false);
  await verifyRuntimeFiles(dirname(modelPath),[{path:model.model.url,...model.model}]);
  add(skill+'model/boundary.manifest.json',modelBytes);add(skill+'model/'+model.model.url,await readFile(bundlePath(dirname(modelPath),model.model.url)));
  add(skill+'runtime.json',json({schemaVersion:1,codeRevision:revision,dataRevision:config.revision,files:seed,
    model:{path:'model/boundary.manifest.json',bytes:modelBytes.length,sha256:hash(modelBytes)},ocrResources}));
  const outer=structuredClone(source);outer.name='map-toolkit';
  outer.description='Find or attach maps, review georeferencing and boundary candidates, and download GeoJSON in private Work.';
  const ui=outer.extensions['com.openai'].interface;ui.composerIcon='./'+skill+'assets/map-toolkit.svg';ui.logo=ui.composerIcon;
  add('plugin.json',json(outer));
  const total=entries.reduce((sum,row)=>sum+row.data.length,0);
  await mkdir(dirname(directory),{recursive:true});const free=await statfs(dirname(directory));
  if(free.bavail*free.bsize<total*3+5*1024**3)throw Error('Private package requires peak size plus 5GiB headroom');
  const files=await writeArtifactFiles(directory,entries);await verifyRuntimeFiles(directory,files);
  // Verify the exact packaged source/WASM pairing without compiling or rebinding it.
  const seedRoot=join(directory,skill,'runtime/workspace');
  const {loadNodeCore}=await import(pathToFileURL(join(seedRoot,'tools/load-node-core.mjs')));await loadNodeCore({root:seedRoot});
  return {version:source.version,codeRevision:revision,dataRevision:config.revision,modelSha256:model.model.sha256,
    directory,fileCount:files.length,uncompressedBytes:total,...await archiveDirectory(directory,{python})};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{revision:{type:'string'},directory:{type:'string'},model:{type:'string'},python:{type:'string'}}});
  try{console.log(JSON.stringify(await packagePrivatePlugin({revision:values.revision,directory:values.directory,modelPath:values.model,python:values.python}),null,2));}
  catch(error){console.error(error);process.exitCode=1;}
}
