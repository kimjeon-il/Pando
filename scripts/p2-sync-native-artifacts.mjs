// Called only inside the P2 staged checkout after its Web source commit exists.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planWorldSync, applyWorldSyncPlan } from '../native/tools/sync-world-data.mjs';
import { safePath } from './lib/p2-artifact-graph.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const webRef=process.env.PANDO_P2_SOURCE_SHA;
assert.match(webRef||'',/^[a-f0-9]{40}$/,'P2_NATIVE_COMMITTED_WEB_SOURCE_REQUIRED');
// The stage controller proves that every file is copied from this clean SHA.
// A local reader prevents the owner's optional remote download path.
const plan=await planWorldSync({appRoot:resolve(root,'native'),webRef,
  reader:async path=>readFileSync(safePath(root,path))});
applyWorldSyncPlan({appRoot:resolve(root,'native'),plan,approveBundle:plan.webBundleSha256});
// The current physical manifests remain pinned. Mirror their declared payloads
// from the already verified Web snapshot, including optional terrain tiles.
const native=JSON.parse(readFileSync(safePath(root,'native/assets/world/manifest.json')));
for(const role of ['hydro','terrain']) {
  const spec=native[role],manifest=JSON.parse(readFileSync(safePath(root,spec.source.path)));
  const assets=manifest.container?{[manifest.container.url]:manifest.container}:manifest.tiles;
  assert.ok(assets,'P2_NATIVE_PHYSICAL_ASSETS_REQUIRED: '+role);
  for(const name of Object.keys(assets)) {
    const source=dirname(spec.source.path).replaceAll('\\','/')+'/'+name;
    const target=safePath(root,'native/assets/world/'+dirname(spec.path).replaceAll('\\','/')+'/'+name);
    mkdirSync(dirname(target),{recursive:true});copyFileSync(safePath(root,source),target);
  }
}
execFileSync(process.execPath,['native/tools/sync-historical-world-timeline.mjs','--web-root',root],{cwd:root,stdio:'inherit'});
for(const file of ['manifest.json','places-v1.bin']) {
  const target=safePath(root,'native/assets/place/'+file);
  mkdirSync(dirname(target),{recursive:true});copyFileSync(safePath(root,'assets/data/places/'+file),target);
}
