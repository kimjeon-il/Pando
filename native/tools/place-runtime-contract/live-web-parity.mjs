#!/usr/bin/env node
// Verify the native review mirror against Web files in the same commit.
// The pinned SHA-only snapshot test is intentionally separate from this live-drift gate.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const monorepoRoot=resolve(root,'..');
const manifest=JSON.parse(readFileSync(resolve(root,'reports/places/source-manifest.json'),'utf8'));
const sha1=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');

export function parseGitTree(text) {
  return text.split('\n').filter(Boolean).map(line=>{
    const match=/^\d+ blob ([a-f0-9]{40})\treports\/places\/(.+)$/.exec(line);
    if(!match)throw Error('Unexpected Web reports Git tree entry: '+line);
    return {type:'file',name:match[2],sha:match[1]};
  });
}

export function compareCurrentWeb(registered,upstream,readLocal) {
  const files=new Map();
  for(const row of upstream) {
    if(row.type==='file' && typeof row.name==='string' && /^[a-f0-9]{40}$/.test(row.sha))
      files.set('reports/places/'+row.name,row.sha);
  }
  const mirrored=new Set(registered.files.map(row=>row.path));
  const errors=[];
  for(const row of registered.files) {
    const current=files.get(row.path);
    if(!current){errors.push('Missing upstream file: '+row.path);continue;}
    if(current!==row.gitBlobSha)
      errors.push('Stale Web source: '+row.path+' (upstream '+current.slice(0,12)+', pinned '+row.gitBlobSha.slice(0,12)+')');
    const local=sha1(readLocal(row.path));
    if(local!==row.gitBlobSha)
      errors.push('Local mirror differs from pinned Git blob: '+row.path);
  }
  const upstreamBatches=[...files.keys()].filter(path=>/^reports\/places\/tier1-major-cities-batch\d{2}.*\.json$/u.test(path)).sort();
  const localBatches=[...mirrored].filter(path=>/^reports\/places\/tier1-major-cities-batch\d{2}.*\.json$/u.test(path)).sort();
  if(upstreamBatches.join('\n')!==localBatches.join('\n')) {
    errors.push('Batch inventory differs: upstream '+upstreamBatches.length+', mirror '+localBatches.length);
    for(const path of upstreamBatches)if(!mirrored.has(path))errors.push('New upstream review batch not mirrored: '+path);
  }
  return {errors,assetCount:registered.files.length,batchCount:upstreamBatches.length};
}

const called=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(called) {
  try {
    const git=(...args)=>execFileSync('git',args,{cwd:monorepoRoot});
    const list=parseGitTree(git('ls-tree','-r','HEAD','--','reports/places').toString('utf8'));
    const result=compareCurrentWeb(manifest,list,path=>git('show','HEAD:native/'+path));
    if(result.errors.length) {
      for(const error of result.errors)console.error('PARITY: '+error);
      process.exitCode=1;
    } else {
      console.log('Same-commit Web/Native place mirror OK: '+result.assetCount+
        ' mirrored assets, '+result.batchCount+' reviewed batches.');
    }
  } catch(error) {
    console.error('Same-commit place mirror check failed:',error);
    process.exitCode=1;
  }
}
