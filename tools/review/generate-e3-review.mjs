import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  collectRevisionDiff, createPendingRevisionReview, verificationSummary,
} from './e3-revision-diff.mjs';
import {normalizeReviewBundle, reviewState} from "../../src/document/review-change-records.js";
import {territorialSourceIndex,readTerritorialArchiveEntity} from '../data/territorial-source-archive.mjs';

const SHA=/^[a-f0-9]{40}$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function error(msg){throw Object.assign(new Error(msg),{code:'PL-E3-INPUT'});}
function parseOptions(argv) {
  const allowed=new Set(['base','candidate','data-root','output-dir','evidence-path','comparison-month','proposal-id','created-at','code-revision','batch-index','batch-size']);
  const options={};
  for(const arg of argv){
    const match=/^--([a-z-]+)=(.+)$/.exec(arg);
    if(!match||!allowed.has(match[1])||Object.hasOwn(options,match[1]))
      error('Unknown, duplicate or empty E3 argument: '+arg);
    options[match[1]]=match[2];
  }
  for(const key of ['base','candidate','data-root','output-dir','comparison-month','code-revision'])
    if(!options[key])error('Explicit --'+key+' is mandatory.');
  for(const key of ['base','candidate','code-revision'])
    if(!SHA.test(options[key]))error('--'+key+' must be a full 40-character Git SHA.');
  if(options['base']===options['candidate'])error('Source revisions must differ.');
  if((options['evidence-path']&&!options['proposal-id'])||(!options['evidence-path']&&options['proposal-id']))
    error('Proposals require both --evidence-path and --proposal-id.');
  if(!options['created-at']&&options['proposal-id'])error('Proposals require an explicit immutable --created-at timestamp.');
  for(const key of ['batch-index','batch-size'])if(options[key]!==undefined
    &&(!/^[1-9]\d*$/.test(options[key])||!Number.isSafeInteger(Number(options[key]))))
    error('--'+key+' must be a positive integer.');
  if(options['batch-size']!==undefined&&Number(options['batch-size'])>200)
    error('--batch-size exceeds the maximum of 200 source entities.');
  return options;
}
function git(root,...args){
  return execFileSync('git',['-c','core.autocrlf=false',...args],{
    cwd:root,encoding:null,maxBuffer:48*1024*1024,timeout:60000,stdio:['ignore','pipe','pipe'],
    env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'0'},
  });
}
function atRevision(root,revision,path){
  if(!/^[a-f0-9]{40}$/.test(revision)||!/^[-A-Za-z0-9_./]+$/.test(path)||path.includes('..')
    ||path.startsWith('/')||path.includes('//'))error('Unsafe immutable Git input ref/path.');
  return git(root,'show',revision+':'+path);
}
function openDataRoot(folder){
  const root=realpathSync(resolve(folder));
  if(!existsSync(join(root,'.git')))error('E3 requires an existing prepared data-library Git checkout.');
  const remote=git(root,'remote','get-url','origin').toString('utf8').trim();
  if(!/(^https:\/\/github\.com\/kimjeon-il\/PandoLab-library(?:\.git)?$|^git@github\.com:kimjeon-il\/PandoLab-library\.git$)/.test(remote))
    error('E3 refuses a different external data repository: '+remote);
  return root;
}
const readIndex=(root,rev)=>{
  return territorialSourceIndex(JSON.parse(atRevision(root,rev,'archive/index.json').toString('utf8')));
};
function gitIsAncestor(root,base,candidate){
  try{git(root,'merge-base','--is-ancestor',base,candidate);}
  catch {error('Data candidate must descend from the pinned base Git commit.');}
}
function writeOnce(folder,name,content){
  const path=join(folder,name);
  const bytes=Buffer.from(typeof content==='string'?content:JSON.stringify(content,null,2)+'\n');
  writeFileSync(path,bytes,{flag:'wx'});
  return {name,sha256:hash(bytes),bytes:bytes.length};
}
const envTime=()=>new Date().toISOString();
export function generateE3RevisionEvidence(options) {
  const o=options,root=openDataRoot(o['data-root']);
  gitIsAncestor(root,o.base,o.candidate);
  const baseIndex=readIndex(root,o.base),candidateIndex=readIndex(root,o.candidate);
  const diff=collectRevisionDiff({
    baseRevision:o.base,candidateRevision:o.candidate,baseIndex,candidateIndex,
    readEntity:({revision,entityId})=>readTerritorialArchiveEntity(revision===o.base?baseIndex:candidateIndex,
      entityId,path=>atRevision(root,revision,path)),comparisonMonth:o['comparison-month'],
    maxEntities:o['batch-size']?Number(o['batch-size']):50,
    batchIndex:o['batch-index']?Number(o['batch-index']):null,
  });
  const verification=verificationSummary(diff,{codeRevision:o['code-revision']});
  const bundle=o['evidence-path'] && diff.changes.length ? (() => {
    const reportPath=o['evidence-path'];
    if(!/^reports\/(?:borders|hydro|places|terrain|map-analysis|development)\/[^/]+\/.+\.md$/.test(reportPath)||reportPath.includes('..'))
      error('E3 requires one canonical Markdown evidence path.');
    const bytes=atRevision(root,o.candidate,reportPath);
    if(!bytes.length)error('Historical report is empty: '+reportPath);
    return createPendingRevisionReview(diff,{
      proposalId:o['proposal-id'],createdAt:o['created-at'],createdBy:'automation',
      evidence:{reportPath,revision:o.candidate},
    });
  })():null;
  const outputDir=resolve(o['output-dir']);
  mkdirSync(outputDir,{recursive:true});
  const files=[
    writeOnce(outputDir,'e3-source-diff.json',diff),
    writeOnce(outputDir,'e3-verification.json',verification),
  ];
  if(bundle){
    const saved=normalizeReviewBundle(bundle);
    if(saved.events.length!==0||reviewState(saved).status!=='pending')error('E3 may only emit a pending proposal.');
    files.push(writeOnce(outputDir,'e3-pending-proposal.json',saved));
  }
  const manifest={
    schemaVersion:1,kind:'e3-generated-revision-evidence',
    codeRevision:o['code-revision'],dataset:diff.dataset,scope:diff.scope,
    totalChangedEntities:diff.totalChangedEntities,
    proposalId:bundle?.proposal.proposalId??null,
    status:diff.issues.length?'requires-manual-interval-review':diff.changes.length?'awaiting-human-review':'no-map-changes',
    createdAt:o['created-at']??envTime(),files,
    caveat:'Generated comparison and checks do not verify shared-border topology, historical accuracy, or human approval.',
  };
  writeOnce(outputDir,'e3-output-manifest.json',manifest);
  return {manifest,diff,verification,bundle};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const r=generateE3RevisionEvidence(parseOptions(process.argv.slice(2)));
    console.log(JSON.stringify({dataset:r.diff.dataset,
      changedEntities:r.diff.indexChangedEntities,totalChangedEntities:r.diff.totalChangedEntities,
      scope:r.diff.scope,
      changes:r.diff.changes.length,issues:r.diff.issues.length,
      proposalStatus:r.bundle?reviewState(r.bundle).status:null,
      files:r.manifest.files.map(x=>x.name),
      changedSlots:r.diff.changes.slice(0,20).map(x=>({sourceEntityId:x.sourceEntityId,kind:x.kind,
        field:x.field,validFrom:x.validFrom,validTo:x.validTo}))},null,2));
  }catch(e){
    console.error((e.code||'PL-E3-ERROR')+': '+e.message);
    process.exitCode=1;
  }
}
