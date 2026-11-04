// Reuse a verification executable only for its exact Git commit and native input hash.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeInputIdentity,verifyNativeBundle} from '../apps/editor/native-contract.mjs';
import {inspectWindowsBinary} from '../apps/editor/native-producer.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function windowsCacheIdentity(repository=root){
  return nativeInputIdentity(repository,{platform:'windows',mode:'verification'});
}
export function verifyWindowsCache({repository=root,identity=windowsCacheIdentity(repository),
  directory=join(repository,'build-native/native-artifacts/windows/verification'),
  sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim(),
  inspect=inspectWindowsBinary}={}) {
  const manifest=verifyNativeBundle(directory,identity);
  assert.equal(manifest.sourceCommit,sourceCommit,'Windows cache source commit mismatch');
  const info=inspect(resolve(directory,'pandolab-web-shell.exe'));
  assert.equal(info.nativeInputSha256,identity.sha256,'Windows cached binary hash identity mismatch');
  assert.equal(info.executionMode,'verification','Windows cached binary execution mode mismatch');
  assert.equal(info.sourceCommit,sourceCommit,'Windows cached binary source commit mismatch');
  return {sourceCommit,sha256:identity.sha256,files:manifest.files};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const command=process.argv[2];
  if(command==='--identity'){
    const id=windowsCacheIdentity();
    if(process.argv.includes('--github-output')){
      if(!process.env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT required');
      appendFileSync(process.env.GITHUB_OUTPUT,'cache_key='+id.sha256+'\n');
    }
    console.log(JSON.stringify({sha256:id.sha256,mode:id.mode,platform:id.platform}));
  }else if(command==='--verify'){
    if(process.env.GITHUB_ACTIONS!=='true'||process.platform!=='win32')
      throw Error('Windows cache verification requires a Windows GitHub Actions runner');
    console.log(JSON.stringify(verifyWindowsCache()));
  }else throw Error('Expected --identity|--verify');
}
