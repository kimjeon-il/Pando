// Build a minimal shared dependency, from reviewed Pando source and existing CI binaries.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname,relative,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encodeSharedToolkit,verifySharedToolkit} from "../data/shared-toolkit.mjs";
import {sharedSourceManifest} from "./package-shared-core-assets.mjs";
import {mapImageSourceFiles,collectMapImageArtifacts} from "../map-image/native-resample.mjs";
import {mapPdfSourceFiles,collectMapPdfArtifacts} from "../map-image/native-pdf.mjs";
import {mapPreviewSourceFiles,collectMapPreviewArtifacts} from "../map-image/native-preview.mjs";
import {loadNodeCore} from "./load-node-core.mjs";
import {frontendWasmRoot} from "../../scripts/lib/frontend-layout.mjs";

export async function packageSharedToolkit({root,revision,artifacts,baseDependency}={}){
  if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Full Pando source revision required');
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  const names=new Set(),sourceNames=new Set(),entries=[];
  const add=(path,data)=>{if(names.has(path))return;names.add(path);entries.push({path,data});};
  function visit(path){
    if(names.has(path))return;
    const data=Buffer.from(execFileSync('git',['show',revision+':'+path],{cwd:root,maxBuffer:64*1024**2}));
    sourceNames.add(path);
    add(path,data);
    if(!/\.[cm]?js$/.test(path))return;
    for(const m of data.toString('utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"]+)\1/g))
      visit(relative(root,resolve(root,dirname(path),m[2])).split(sep).join('/'));
  }
  if(baseDependency){
    const previous=await verifySharedToolkit(baseDependency.root,baseDependency.pin);
    const storageFiles=new Set(baseDependency.pin.source.storageFiles||[]);
    if(!storageFiles.size&&previous.files.some(row=>row.path.startsWith('tools/data/')))throw Error('The base SDK must declare its storage component before an upgrade.');
    const retired=path=>/^tools\/(library-[^/]+|report-paths|shared-toolkit)\.mjs$/.test(path);
    const current=new Map(['library-archive','library-content','library-git','library-report-layout','library-runtime-index','report-paths','shared-toolkit']
      .map(name=>['tools/'+name+'.mjs','tools/data/'+name+'.mjs']));
    for(const row of previous.files){
      if(retired(row.path)||storageFiles.has(row.path))continue;
      let data=readFileSync(resolve(baseDependency.root,row.path));
      if(/\.[cm]?js$/.test(row.path))data=Buffer.from(data.toString('utf8').replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"]+)\2/g,(text,prefix,quote,specifier)=>{
        const path=relative(root,resolve(root,dirname(row.path),specifier)).split(sep).join('/');
        if(!retired(path))return text;
        const target=current.get(path);if(!target)throw Error('A current consumer still imports retired storage: '+row.path+' -> '+path);
        visit(target);
        let address=relative(dirname(row.path),target).split(sep).join('/');if(!address.startsWith('.'))address='./'+address;
        return prefix+quote+address+quote;
      }));
      add(row.path,data);
    }
  }
  const storageSeeds=['tools/data/shared-toolkit.mjs','tools/data/library-context.mjs','tools/data/library-runtime.mjs','tools/data/report-paths.mjs'];
  for(const name of storageSeeds)visit(name);
  const storageFiles=[...sourceNames].sort();
  const seeds=baseDependency ? [] : ['tools/data/shared-toolkit.mjs','tools/build/load-node-core.mjs','tools/data/report-paths.mjs','tools/lib/geonames-policy.mjs','tools/lib/geonames-zip.mjs',
    'tools/map-image/native-resample.mjs','tools/map-image/native-pdf.mjs','tools/map-image/native-preview.mjs',
    'src/document/source-provenance.js','src/runtime/version-contract.js',
    'src/runtime/worker-rpc.js','src/runtime/workers/worker-rpc-host.js',
    'tools/cpp/map-preview/aileron-subset.ttf','src/geometry/native/vendor/proj-robinson-LICENSE',
    'docs/historical-border-reconstruction-policy.md',...mapImageSourceFiles,...mapPdfSourceFiles,...mapPreviewSourceFiles,
    ...sharedSourceManifest(root).inputs.map(row=>row.path),
    ...['pandoeditor-core.js','pandoeditor-core.wasm','pandoeditor-core.manifest.json'].map(name=>frontendWasmRoot+'/'+name)];
  for(const name of seeds)visit(name);
  if(git(['diff','--name-only',revision,'--',...sourceNames]))throw Error('Shared source differs from pinned commit');
  if(!baseDependency){
    await loadNodeCore({root});
    for(const collect of [collectMapImageArtifacts,collectMapPdfArtifacts,collectMapPreviewArtifacts])
      for(const row of collect({workspace:root,revision,...artifacts}))add(row.path,row.data);
  }
  const source={repository:'kimjeon-il/Pando',revision,storageFiles};
  if(baseDependency){
    source.compute=baseDependency.pin.source.compute||{...baseDependency.pin.source,artifactSha256:baseDependency.pin.sha256};
  }
  return encodeSharedToolkit({source,entries});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const root=fileURLToPath(new URL("../../",import.meta.url)),revision=process.argv[2],output=process.argv[3];
  if(!output)throw Error('Usage: package-shared-toolkit.mjs REVISION NEW_ARCHIVE');
  const result=await packageSharedToolkit({root,revision});
  writeFileSync(output,result.bytes,{flag:'wx'});console.log(JSON.stringify(result.pin));
}
