// Build a branch-specific, downloadable static Web snapshot without touching Pages.
// Code and its pinned external runtime assets preserve relative asset URLs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLibraryData } from '../tools/library-data.mjs';
import { previewSlug } from './p3-plan-remote.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const isInside=(base,file)=>{const rel=relative(base,file);
  return rel!=='' && rel!=='..' && !rel.startsWith('..'+sep) && !isAbsolute(rel);
};
export function stagePreview({root,output,branch}) {
  const source=resolve(root),dest=resolve(output),slug=previewSlug(branch);
  if(dest===source||isInside(source,dest))throw Error('P3_PREVIEW_OUTPUT_INSIDE_SOURCE');
  if(existsSync(dest))throw Error('P3_PREVIEW_DESTINATION_EXISTS');
  const files=execFileSync('git',['ls-files','-z','--','index.html','.nojekyll','assets/'],
    {cwd:source,maxBuffer:16*1024*1024})
    .toString('utf8').split('\0').filter(Boolean).sort();
  const library=existsSync(resolve(source,'config/library-data.json'))?prepareLibraryData({root:source}):null;
  if(library)files.push(...Object.entries(library.files).filter(([path,entry])=>path.startsWith('assets/data/')&&entry.stored===path).map(([path])=>path));
  const paths=new Set(files);
  const mandatory=['index.html','.nojekyll','assets/data/world/current.json'];
  if(paths.has('assets/js/workers/core-session-worker.js'))mandatory.push(
    'assets/wasm/pandoeditor-core.js','assets/wasm/pandoeditor-core.wasm',
    'assets/wasm/pandoeditor-core.manifest.json');
  for(const item of mandatory)if(!paths.has(item))
    throw Error('P3_PREVIEW_MISSING_RUNTIME: '+item);
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],
    {cwd:source,encoding:'utf8'}).trim();
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('P3_PREVIEW_SOURCE_COMMIT');
  const entries=[],maxBytes=850_000_000;let total=0;
  mkdirSync(dest,{recursive:true});
  for(const name of files) {
    if(!/^(?:index\.html|\.nojekyll|assets\/[a-zA-Z0-9._/-]+)$/.test(name) ||
      name.split('/').includes('..'))throw Error('P3_PREVIEW_INVALID_PATH: '+name);
    const input=resolve(source,name),target=resolve(dest,name);
    if(!isInside(source,input)||!isInside(dest,target)||
       !lstatSync(input).isFile())throw Error('P3_PREVIEW_NONREGULAR_INPUT: '+name);
    const b=readFileSync(input);
    if(library?.files[name]&&sha(b)!==library.files[name].sha256)throw Error('P3_PREVIEW_LIBRARY_TRANSFER_MISMATCH: '+name);
    total+=b.length;
    if(total>maxBytes)throw Error('P3_PREVIEW_MAX_BYTES_EXCEEDED');
    mkdirSync(dirname(target),{recursive:true});
    copyFileSync(input,target);
    chmodSync(target,0o600);
    if(sha(readFileSync(target))!==sha(b))throw Error('P3_PREVIEW_COPY_MISMATCH: '+name);
    entries.push({path:name,bytes:b.length,sha256:sha(b)});
  }
  const manifest={schema:'pando-branch-preview-v1',branch,slug,sourceCommit,
    dataRepository:library?.repository,dataCommit:library?.revision,
    mode:'downloadable-static-snapshot',publicUrl:null,files:entries.length,bytes:total,
    included:entries, excludes:['native/**','shared/**','reports/**','tests/**','tools/**']};
  writeFileSync(join(dest,'preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  writeFileSync(join(dest,'README-PREVIEW.txt'),
    'Pando branch snapshot: '+branch+'\nSource: '+sourceCommit+'\n'+
    'This is a downloadable CI artifact, NOT a public live deployment.\n'+
    'Serve this directory with: python -m http.server 8080\n'+
    'Open http://127.0.0.1:8080/ in a browser with WebGL or Canvas support.\n'+
    'The production GitHub Pages site remains untouched.\n');
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),val=(key)=>args[args.indexOf(key)+1];
  if(!args.includes('--root')||!args.includes('--output')||!args.includes('--branch'))
    throw Error('Usage: --root REPOSITORY --output OUTSIDE_REPOSITORY --branch work/objects');
  const result=stagePreview({root:val('--root'),output:val('--output'),branch:val('--branch')});
  console.log(JSON.stringify({branch:result.branch,commit:result.sourceCommit,
    files:result.files,bytes:result.bytes,slug:result.slug},null,2));
}
