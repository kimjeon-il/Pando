// Single entry-point policy for project-owned native compilers and SDK downloads.
// Only the explicitly selected remote-only development branch is affected.
import {spawnSync} from 'node:child_process';

export function remoteOnlyBranch({root=process.cwd(),environment=process.env,branch,
  probe=directory=>spawnSync('git',['-C',directory,'symbolic-ref','--quiet','--short','HEAD'],
    {encoding:'utf8',timeout:2000,windowsHide:true}).stdout?.trim()||''}={}) {
  return environment.PANDO_REMOTE_ONLY==='1'||(branch??probe(root))==='work/remote-only';
}

export function assertRemoteOnlyNativeAllowed({root=process.cwd(),environment=process.env,branch,probe,
  operation='native build or SDK setup'}={}) {
  if(remoteOnlyBranch({root,environment,branch,probe})&&environment.GITHUB_ACTIONS!=='true') {
    throw Object.assign(new Error('PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED: '+operation+
      ' belongs to source-pinned GitHub Actions. No local SDK download, compiler launch or native artifact installation is permitted.'),{
      code:'PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED'
    });
  }
}
