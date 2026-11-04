// Single entry-point policy for project-owned native compilers and SDK downloads.
// Only the explicitly selected remote-only development branch is affected.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function remoteOnlyBranch({root=process.cwd(),environment=process.env,branch,
  probe=directory=>spawnSync('git',['-C',directory,'symbolic-ref','--quiet','--short','HEAD'],
    {encoding:'utf8',timeout:2000,windowsHide:true}).stdout?.trim()||''}={}) {
  if(environment.PANDO_REMOTE_ONLY==='1')return true;
  // Explicit test branches can be injected without inspecting unrelated checkouts.
  if(branch!==undefined)return branch==='work/remote-only';
  // A tracked marker protects detached-HEAD checkouts as well as named branches.
  const marker=resolve(root,'config/remote-only-policy.json');
  if(existsSync(marker)){
    const value=JSON.parse(readFileSync(marker,'utf8'));
    if(value.schema!=='pando-remote-only-policy-v1'||
      value.nativeBuildLocation!=='github-actions'||value.localSdkInstallation!==false)
      throw Error('Unknown remote-only policy marker; refuse implicit native setup');
    return true;
  }
  return probe(root)==='work/remote-only';
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
