import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {isAbsolute, relative, resolve, sep} from 'node:path';

// Keep missing, prunable worktrees protected by their registered paths.
// Other resolution errors remain failures rather than silently weakening the guard.
export function protectedWorktreeRoots(porcelain) {
  const roots=new Set();
  const records=porcelain.split('\0\0').filter(Boolean);
  if(!records.length)throw Error('Empty Git worktree inventory');
  for(const record of records) {
    const fields=record.split('\0'), worktree=fields.find(field=>field.startsWith('worktree '));
    if(!worktree)throw Error('Invalid Git worktree record');
    const path=resolve(worktree.slice(9));roots.add(path);
    try { roots.add(realpathSync.native(path)); }
    catch(error) {
      if(error.code!=='ENOENT'||!fields.some(field=>field==='prunable'||field.startsWith('prunable ')))throw error;
    }
  }
  return [...roots];
}

export function withinWorktree(target,roots) {
  return roots.some(root=>{
    const part=relative(root,target);
    return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));
  });
}

export function registeredWorktreeRoots(projectRoot) {
  const list=execFileSync('git',['-c','core.quotepath=false','worktree','list','--porcelain','-z'],
    {cwd:projectRoot,encoding:'utf8',windowsHide:true});
  return protectedWorktreeRoots(list);
}
