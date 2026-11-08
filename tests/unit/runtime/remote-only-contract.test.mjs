import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {assertRemoteOnlyNativePreparation} from "../../../scripts/prepare-native-test-tools.mjs";
import {remoteOnlyStatus} from "../../../scripts/remote-only-doctor.mjs";
import {selectNativeBuilds} from "../../../scripts/lib/check-changes.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));
const read=path=>readFileSync(resolve(root,path),'utf8');

test('Codespaces never auto-installs packages or opens the on-demand private Viewer preview',()=>{
  const dev=JSON.parse(read('.devcontainer/devcontainer.json'));
  assert.match(dev.image,/javascript-node:24-bookworm/);
  assert.equal(dev.remoteEnv.PANDO_REMOTE_ONLY,'1');
  assert.equal(Object.hasOwn(dev,'postCreateCommand'),false);
  assert.equal(Object.hasOwn(dev,'postStartCommand'),false);
  assert.equal(Object.hasOwn(dev,'forwardPorts'),false);
  assert.equal(dev.portsAttributes['4173'].visibility,'private');
  assert.equal(dev.portsAttributes['4173'].onAutoForward,'ignore');
  assert.equal(dev.otherPortsAttributes.onAutoForward,'ignore');
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
  const preview=read('.devcontainer/start-preview.sh');
  assert.match(preview,/scripts\/frontend-dev-server\.mjs --product=viewer/);
  assert.match(preview,/if \[ ! -d node_modules\/esbuild \]/);
  assert.match(preview,/bash \.devcontainer\/setup-remote\.sh/);
  assert.doesNotMatch(preview,/playwright install|install --with-deps chromium/);
});

test('remote-only development uses source-matched P2 and the shared Viewer/Core workflows',()=>{
  const generated=read('.github/workflows/generated-artifacts-p2.yml');
  assert.match(generated,/branches: \['work\/\*\*'\]/);
  assert.match(generated,/gh workflow run viewer-preview\.yml/);
  const native=read('.github/workflows/shared-core.yml');
  assert.match(native,/work\/remote-only/);
  assert.match(native,/native-branch-core:/);
  assert.match(native,/native-branch-gis:/);
  const preview=read('.github/workflows/viewer-preview.yml');
  assert.match(preview,/work\/\*\*/);
  assert.match(preview,/application-architecture\.yml/);
  const deploy=read('.github/workflows/web-pages.yml');
  assert.match(deploy,/branches:\s*\[main\]/);
  assert.match(deploy,/github\.ref == 'refs\/heads\/main'/);
});

test('remote-only branch has no Windows GUI build job or Tauri CLI dependency',()=>{
  const gate=read('.github/workflows/viewer-preview.yml');
  const p1=read('.github/workflows/shared-core.yml');
  const scripts=JSON.parse(read('package.json')).scripts;
  // Match executable workflow fields only. The post-retirement verifier
  // deliberately *mentions* rejected job names in its own assertions.
  for(const body of [gate,p1]) {
    assert.doesNotMatch(body,/^ {2}(?:windows-real-webview2|native-artifact):\s*$/m);
    assert.doesNotMatch(body,/^\s*runs-on:\s*windows-2022\s*$/m);
    assert.doesNotMatch(body,/^\s*- uses:\s*dtolnay\/rust-toolchain@/m);
    assert.doesNotMatch(body,/^\s*(?:run:\s*)?node apps\/editor\/packaged-artifacts\.mjs --ci-build/m);
  }
  assert.equal(Object.hasOwn(scripts,'dev:windows'),false);
  assert.equal(Object.hasOwn(scripts,'build:windows'),false);
  assert.equal(Object.hasOwn(scripts,'dev:editor'),false);
  const server=read('scripts/frontend-dev-server.mjs');
  assert.doesNotMatch(server,/src-tauri|product==='editor'|--product=viewer\|editor/);
  for(const file of ['apps/editor/src-tauri/tauri.conf.json',
    'apps/editor/src-tauri/icons/icon.ico','apps/editor/src-tauri/icons/icon.png',
    'apps/editor/tests/preflight.mjs'])
    assert.equal(existsSync(resolve(root,file)),false,'Retired native shell file: '+file);
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
  const workflow=read('.github/workflows/viewer-preview.yml');
  assert.doesNotMatch(workflow, /ai-node-analysis-smoke|reference-training-|reference-onnx-|map-analysis-core\.test\.mjs|libtorch|cuda/i);
  const plugin=read('docs/reference-map-plugin.md');
  assert.match(plugin,/github\.com\/kimjeon-il\/map-toolkit/);
  assert.match(plugin,/analysis, training, tests and private releases are owned by/);
  const remoteDocs=read('docs/development/remote-only-development.md');
  assert.match(remoteDocs,/Independent Map Toolkit plugin boundary/);
});

test('Codespaces-only changes do not schedule native C++ rebuilds',()=>{
  const changes=['.devcontainer/devcontainer.json','.devcontainer/start-preview.sh',
    '.devcontainer/setup-remote.sh','.devcontainer/acceptance.sh',
    'tests/unit/runtime/codespaces-acceptance-contract.test.mjs'];
  assert.deepEqual(selectNativeBuilds(changes),{core:false,gis:false,wasm:false});
  assert.equal(selectNativeBuilds([...changes,'shared/core/src/geometry.cpp']).core,true);
  assert.equal(selectNativeBuilds([...changes,'tools/cpp/hydro/connectivity.cpp']).gis,true);
});
