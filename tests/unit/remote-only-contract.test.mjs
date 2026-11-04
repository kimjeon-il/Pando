import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {assertRemoteOnlyNativePreparation} from '../../scripts/prepare-native-test-tools.mjs';
import {remoteOnlyStatus} from '../../scripts/remote-only-doctor.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');

test('Codespaces installs only pinned remote Node dependencies and opens a private live preview',()=>{
  const dev=JSON.parse(read('.devcontainer/devcontainer.json'));
  assert.match(dev.image,/javascript-node:24-bookworm/);
  assert.equal(dev.remoteEnv.PANDO_REMOTE_ONLY,'1');
  assert.equal(dev.postCreateCommand,'bash .devcontainer/setup-remote.sh');
  assert.equal(dev.postStartCommand,'bash .devcontainer/start-preview.sh');
  assert.equal(dev.portsAttributes['4173'].visibility,'private');
  for(const name of ['.devcontainer/setup-remote.sh','.devcontainer/start-preview.sh',
    '.devcontainer/acceptance.sh','.devcontainer/pnpm.sh'])
    assert.match(read(name),/source \.devcontainer\/ensure-node\.sh/,name);
  const bootstrap=read('.devcontainer/ensure-node.sh');
  assert.match(bootstrap,/PANDO_CODESPACES_NODE_MISSING/);
  assert.match(bootstrap,/Codespaces: Rebuild Container/);
  assert.match(bootstrap,/nvm use --silent/);
  assert.doesNotMatch(bootstrap,/nvm install|apt-get install|npm install/);
  const setup=read('.devcontainer/setup-remote.sh');
  assert.match(setup,/CODESPACES/);
  assert.match(setup,/pnpm.sh install --frozen-lockfile --ignore-scripts/);
  assert.doesNotMatch(setup,/\b(?:emcmake|cmake|cargo|micromamba|sdkmanager)\s+(?:install|build|create)\b/i);
  const pnpm=read('.devcontainer/pnpm.sh');
  assert.match(pnpm,/packageManager/);
  assert.match(pnpm,/npm exec --yes --package=/);
  assert.match(read('.devcontainer/start-preview.sh'),/scripts\/frontend-dev-server\.mjs --product=viewer/);
});

test('the remote-only branch runs P1, P2, P3 and a dedicated Node contract in CI',()=>{
  assert.match(read('.github/workflows/remote-development-p1.yml'),/\s- work\/remote-only\s/);
  assert.match(read('.github/workflows/generated-artifacts-p2.yml'),/branches:\s*\['work\/\*\*'\]/);
  assert.match(read('.github/workflows/remote-preview-p3.yml'),/- work\/\*\*/);
  assert.match(read('.github/workflows/remote-only-gate.yml'),/branches:\s*\[work\/remote-only\]/);
  const deploy=read('.github/workflows/web-pages.yml');
  assert.match(deploy,/branches:\s*\[main\]/);
  assert.match(deploy,/github\.ref == 'refs\/heads\/main'/);
});

test('native prerequisite preparation is rejected outside Actions on the new branch',()=>{
  for(const environment of [{PANDO_REMOTE_ONLY:'1'},{GITHUB_ACTIONS:'false'}])
    assert.throws(()=>assertRemoteOnlyNativePreparation({environment,branch:'work/remote-only'}),
      /PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED/);
  assert.throws(()=>assertRemoteOnlyNativePreparation({environment:{PANDO_REMOTE_ONLY:'1'},branch:'main'}),
    /PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED/);
  assert.doesNotThrow(()=>assertRemoteOnlyNativePreparation({environment:{GITHUB_ACTIONS:'true'},branch:'work/remote-only'}));
  assert.doesNotThrow(()=>assertRemoteOnlyNativePreparation({environment:{},branch:'work/gis'}));
});

test('preflight is read-only and distinguishes local from cloud readiness',()=>{
  const good=remoteOnlyStatus({rootPath:root,env:{CODESPACES:'true',PANDO_REMOTE_ONLY:'1'},
    major:'24',branch:'work/remote-only',dependencies:true});
  assert.equal(good.ready,true);
  assert.equal(remoteOnlyStatus({rootPath:root,env:{},major:'24',branch:'work/remote-only',dependencies:true}).ready,false);
  assert.equal(remoteOnlyStatus({rootPath:root,env:{CODESPACES:'true',PANDO_REMOTE_ONLY:'1'},
    major:'24',branch:'work/remote-only',dependencies:false}).ready,false);
});

test('AI map-analysis and training remain plugin-owned, outside required app acceptance',()=>{
  const workflow=read('.github/workflows/remote-only-gate.yml');
  assert.doesNotMatch(workflow, /ai-node-analysis-smoke|reference-training-|reference-onnx-|map-analysis-core\.test\.mjs|libtorch|cuda/i);
  const plugin=read('docs/reference-map-plugin.md');
  assert.ok(plugin.includes('plugins/pando-map-tools'));
  const remoteDocs=read('docs/development/remote-only-development.md');
  assert.match(remoteDocs,/Independent Map Toolkit plugin boundary/);
});
