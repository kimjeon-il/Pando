// No installation, build or network activity; read-only Codespaces preflight.
import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
export function remoteOnlyStatus({rootPath=root,env=process.env,major=process.versions.node.split('.')[0],
  branch,dependencies}={}) {
  const pins=JSON.parse(readFileSync(resolve(rootPath,'config/toolchain-versions.json'),'utf8'));
  const pkg=JSON.parse(readFileSync(resolve(rootPath,'package.json'),'utf8'));
  const current=branch??(spawnSync('git',['-C',rootPath,'symbolic-ref','--quiet','--short','HEAD'],
    {encoding:'utf8',timeout:2000}).stdout?.trim()||'');
  const checks={
    codespaces:env.CODESPACES==='true',
    branch:current==='work/remote-only',
    node:major===pins.node,
    packageManager:pkg.packageManager==='pnpm@'+pins.pnpm,
    frontendDependencies:dependencies??existsSync(resolve(rootPath,'node_modules/esbuild')),
    nativeBuildDisabled:env.PANDO_REMOTE_ONLY==='1'
  };
  return {schema:'pando-remote-only-status-v1',branch:current,checks,
    ready:Object.values(checks).every(Boolean),nativeBuildLocation:'GitHub Actions',
    preview:'Private Codespaces port 4173'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const status=remoteOnlyStatus();
  console.log(JSON.stringify(status,null,2));
  if(!status.ready)process.exitCode=1;
}
