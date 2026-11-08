import assert from 'node:assert/strict';


import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {assertRemoteOnlyNativePreparation} from "../../../scripts/prepare-native-test-tools.mjs";
import {remoteOnlyStatus} from "../../../scripts/remote-only-doctor.mjs";
import {selectNativeBuilds} from "../../../scripts/lib/check-changes.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url));


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

test('Codespaces-only changes do not schedule native C++ rebuilds',()=>{
  const changes=['.devcontainer/devcontainer.json','.devcontainer/start-preview.sh',
    '.devcontainer/setup-remote.sh','.devcontainer/acceptance.sh',
    'tests/unit/runtime/remote-only-contract.test.mjs'];
  assert.deepEqual(selectNativeBuilds(changes),{core:false,gis:false,wasm:false});
  assert.equal(selectNativeBuilds([...changes,'shared/core/src/geometry.cpp']).core,true);
  assert.equal(selectNativeBuilds([...changes,'tools/cpp/hydro/connectivity.cpp']).gis,true);
});
