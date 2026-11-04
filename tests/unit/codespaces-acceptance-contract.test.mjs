import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import test from 'node:test';
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>readFileSync(resolve(root,p),'utf8');

test('acceptance requires real Codespaces and no test server fallback',()=>{
  const shell=read('.devcontainer/acceptance.sh');
  assert.match(shell,/CODESPACES/);assert.match(shell,/CODESPACE_NAME/);
  assert.match(shell,/remote-only-doctor/);
  assert.match(shell,/source \.devcontainer\/ensure-node\.sh/);
  const config=read('playwright.codespaces.config.js');
  assert.doesNotMatch(config,/webServer\s*:/);
  assert.match(config,/127\.0\.0\.1:4173/);
});
test('Codespaces test checks real viewer, navigation, reloading and protects tracked sources',()=>{
  const spec=read('tests/browser/codespaces-live.spec.mjs');
  for(const key of ['__shell/health','executionMode','pandoeditor-core.wasm','visibleTerritorialCount','timelinePreviousYear','framenavigated','revision','unlink(probe)','finally','config/library-data.json'])
    assert.ok(spec.includes(key),key);
  assert.match(spec,/sourceCreated:created,sourceEdited:edited/);
  assert.match(spec,/Codespaces source editing acceptance: B/);
  assert.match(spec,/revisionAfter\)\.toBeGreaterThan\(created\.revisionAfter\)/);
  assert.match(spec,/await page\.screenshot/);
  assert.doesNotMatch(spec,/git\s+(?:reset|clean|checkout)/);
});

test('live Codespaces spec is owned by the manual-only test catalog group',()=>{
  const catalog=JSON.parse(read('scripts/contracts/application-checks.json'));
  const groups=catalog.groups.filter(g=>(g.testPatterns||[]).includes('tests/browser/codespaces-live.spec.mjs'));
  assert.equal(groups.length,1);
  assert.equal(groups[0].mode,'manual');
});
