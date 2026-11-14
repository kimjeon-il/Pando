import {execFileSync} from 'node:child_process';
import {mkdtempSync, realpathSync, rmdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute, join} from 'node:path';

export const rawLibraryBranchRef='refs/heads/work/gis-raw-modern';
const oidPattern=/^[a-f0-9]{40}$/;
const modePattern=/^100644 blob /;
const error=(code,message,cause)=>Object.assign(new Error(message,{cause}),{code:'PANDO_RAW_BRANCH_'+code});
const scope=path=>error('SCOPE','Invalid raw branch write path: '+path);
const stale=cause=>error('STALE','Existing raw branch differs from the expected local revision.',cause);

function safeGitPath(path){
  return typeof path==='string'&&path.length<=1024&&path.split('/').every(part=>
    (part==='.originals'&&/^assets\/data\/territorial-entities\/\.originals\/[a-f0-9]{64}\.(?:gz|bin)$/.test(path)||
    /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part))&&!part.endsWith('.')&&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function isolatedGit(repository,operation){
  const scratch=mkdtempSync(join(tmpdir(),'pando-raw-branch-index-'));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
  Object.assign(env,{GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1',
    GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'});
  const opts=['-c','maintenance.auto=false','-c','gc.auto=0','-c','core.sparseCheckout=false',
    '-c','index.sparse=false','-c','core.splitIndex=false','-c','core.ignoreCase=false',
    '-c','core.hooksPath='+scratch,'-c','commit.gpgSign=false'];
  const git=(args,{input,index=false}={})=>execFileSync('git',[...opts,...args],{
    cwd:repository,input,maxBuffer:128*1024*1024,windowsHide:true,stdio:['pipe','pipe','pipe'],
    env:index?{...env,GIT_INDEX_FILE:join(scratch,'index')}:env
  });
  const read=(...args)=>git(args).toString('utf8').trim();
  try{return operation({git,read});}
  finally{rmSync(join(scratch,'index'),{force:true});rmSync(join(scratch,'index.lock'),{force:true});rmdirSync(scratch);}
}

function assertRepositoryRoot(read,repository){
  const bare=read('rev-parse','--is-bare-repository')==='true';
  const top=realpathSync.native(read('rev-parse',bare?'--absolute-git-dir':'--show-toplevel'));
  if(top!==repository)throw error('SCOPE','Raw branch publisher requires the exact repository root.');
}

function rawBranchPreflight(read,repository,expectedRevision){
  assertRepositoryRoot(read,repository);
  let head;
  try{head=read('symbolic-ref','-q','--no-recurse','HEAD');}
  catch(cause){throw error('CHECKED_OUT','Cannot publish while the repository HEAD is detached.',cause);}
  if(head===rawLibraryBranchRef)throw error('CHECKED_OUT','Raw branch must not be checked out.');
  // Reject linked worktrees rather than racing checkout/index ownership in a separate worktree.
  const owners=read('worktree','list','--porcelain','-z').split('\0\0').filter(Boolean);
  if(owners.length!==1)throw error('CHECKED_OUT','Raw-only storage requires a single shared repository checkout.');
  try{read('symbolic-ref','-q','--no-recurse',rawLibraryBranchRef);
    throw error('SYMBOLIC','Refusing a symbolic raw reference.');
  }catch(cause){if(cause.status!==1)throw cause;}
  let actual;
  try{actual=read('show-ref','--verify','--hash',rawLibraryBranchRef);}
  catch(cause){if(cause.status===128||cause.status===1)throw stale(cause);throw cause;}
  if(actual!==expectedRevision)throw stale();
  if(read('cat-file','-t',actual)!=='commit')throw error('SCOPE','Expected raw reference to name a commit.');
  return head;
}

function verifyPathTypes(git,revision,paths){
  const trees=new Map();
  for(const path of paths){
    const parts=path.split('/');
    let directory='';
    for(let i=0;i<parts.length;i++){
      if(!trees.has(directory)){
        const obj=revision+(directory?':'+directory:'');
        trees.set(directory,git(['ls-tree','-z',obj]).toString('utf8').split('\0').filter(Boolean).map(r=>{
          const tab=r.indexOf('\t');
          return {entry:r.slice(0,tab),name:r.slice(tab+1)};
        }));
      }
      const matches=trees.get(directory).filter(row=>row.name.toLowerCase()===parts[i].toLowerCase());
      if(!matches.length)break;
      if(matches.length!==1||matches[0].name!==parts[i]||
        !(i===parts.length-1?modePattern.test(matches[0].entry):matches[0].entry.startsWith('040000 tree ')))throw scope(path);
      directory+=(directory?'/':'')+parts[i];
    }
  }
}

function canonicalRepository(repository,revision){
  if(typeof repository!=='string'||!isAbsolute(repository)||typeof revision!=='string'||!oidPattern.test(revision))
    throw error('SCOPE','Absolute repository and exact expected Git object ID required.');
  return realpathSync.native(repository);
}

export function assertRawBranchTarget(repository,expectedRevision){
  const canonical=canonicalRepository(repository,expectedRevision);
  return isolatedGit(canonical,({read})=>Object.freeze({repository:canonical,revision:expectedRevision,
    headRef:rawBranchPreflight(read,canonical,expectedRevision)}));
}

export function readRawGitBlob(repository,revision,path){
  const canonical=canonicalRepository(repository,revision);
  if(!safeGitPath(path))throw scope(path);
  return isolatedGit(canonical,({git,read})=>{
    assertRepositoryRoot(read,canonical);
    if(read('cat-file','-t',revision)!=='commit')throw error('SCOPE','Raw branch read requires an exact commit.');
    const entry=git(['--literal-pathspecs','ls-tree','-z',revision,'--',path]).toString();
    if(!entry)return null;
    if(!modePattern.test(entry)||!entry.endsWith('\t'+path+'\0')||entry.split('\0').length!==2)throw scope(path);
    return git(['cat-file','blob',revision+':'+path]);
  });
}

// Low-level commit staging only. The caller must validate logical archive scope,
// evidence, leases and source invariants before supplying these exact tree bytes.
export function stageRawBranchCommit({repository,expectedRevision,paths,message}){
  const canonical=canonicalRepository(repository,expectedRevision);
  if(!(paths instanceof Map)||!paths.size||typeof message!=='string'||!message.trim()||message.includes('\0'))
    throw error('SCOPE','Exact file buffers and a commit message are required.');
  const files=new Map(),seen=new Set(),casePaths=new Map();
  for(const [path,bytes] of paths){
    if(!safeGitPath(path)||!Buffer.isBuffer(bytes)||seen.has(path.toLowerCase()))throw scope(path);
    seen.add(path.toLowerCase());files.set(path,Buffer.from(bytes));
    let prefix='';
    for(const part of path.split('/')){
      prefix+=(prefix?'/':'')+part;
      const key=prefix.toLowerCase();
      if(casePaths.has(key)&&casePaths.get(key)!==prefix)throw scope(path);
      casePaths.set(key,prefix);
    }
  }
  for(const path of seen){
    const parts=path.split('/');
    for(let i=1;i<parts.length;i++)if(seen.has(parts.slice(0,i).join('/')))throw scope(path);
  }
  const revision=isolatedGit(canonical,({git,read})=>{
    rawBranchPreflight(read,canonical,expectedRevision);
    verifyPathTypes(git,expectedRevision,files.keys());
    git(['read-tree',expectedRevision],{index:true});
    const records=[],changed=new Set();
    for(const [path,bytes] of files){
      const hash=git(['hash-object','-w','--stdin'],{input:bytes}).toString().trim();
      if(!oidPattern.test(hash))throw scope(path);
      const existing=git(['--literal-pathspecs','ls-tree','-z',expectedRevision,'--',path]).toString();
      if(existing!==`100644 blob ${hash}\t${path}\0`)changed.add(path);
      records.push(`100644 ${hash}\t${path}\0`);
    }
    if(!changed.size)throw error('NO_CHANGE','No changed scoped bytes to commit.');
    git(['update-index','-z','--index-info'],{index:true,input:records.join('')});
    const tree=git(['write-tree'],{index:true}).toString().trim();
    const out=git(['diff-tree','-r','--no-commit-id','--name-status','--no-renames','-z',expectedRevision,tree]).toString().split('\0');
    for(let i=0;i<out.length-1;i+=2)if(!['A','M'].includes(out[i])||!changed.delete(out[i+1]))throw scope(out[i+1]);
    if(changed.size)throw error('SCOPE','Raw branch tree did not contain every expected change.');
    for(const [path,bytes] of files){
      if(!git(['cat-file','blob',tree+':'+path]).equals(bytes))throw scope(path);
    }
    const child=read('-c','user.name=Pando library storage','-c','user.email=library-storage@users.noreply.github.com',
      'commit-tree',tree,'-p',expectedRevision,'-m',message);
    if(!oidPattern.test(child)||read('rev-parse',child+'^')!==expectedRevision||read('rev-parse',child+'^{tree}')!==tree)
      throw error('SCOPE','Unexpected staged raw commit.');
    return child;
  });

  return Object.freeze({revision,publish(){
    return isolatedGit(canonical,({git,read})=>{
      const head=rawBranchPreflight(read,canonical,expectedRevision);
      // Keep the raw branch direct and compare/freeze HEAD while advancing the
      // exact one local ref. A concurrent checkout/ref update makes this fail.
      try{
        git(['update-ref','-m',message,'--stdin'],{input:[
          'start','option no-deref','symref-verify HEAD '+head,'option no-deref',
          'update '+rawLibraryBranchRef+' '+revision+' '+expectedRevision,'prepare','commit',''
        ].join('\n')});
      }catch(cause){throw stale(cause);}
      if(read('show-ref','--verify','--hash',rawLibraryBranchRef)!==revision)
        throw error('READBACK','Raw ref changed after publication; inspect before retrying.');
      for(const [path,bytes] of files)
        if(!git(['cat-file','blob',revision+':'+path]).equals(bytes))
          throw error('READBACK','Raw branch readback mismatch: '+path);
      return revision;
    });
  }});
}

