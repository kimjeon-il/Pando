// Verify only the project-selected manifest bytes and compiled Core pair.
// Never regenerate or scan every GIS tile or retired asset family.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {mapProjectResourcePath,validateMapProjectManifest} from '../../../src/data/map-project-manifest.js';
import {validateTerrainManifest} from '../../../src/data/terrain-manifest.js';
import {validatePlaceManifest} from '../../../src/data/place-worker-store.js';
import {git,libraryCheckout,libraryConfig,readLibraryDataFile}
  from '../../../tools/data/library-context.mjs';
import {wasmStatus} from '../../../scripts/p2-artifact-plan.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('the pinned library authenticates only selected terrain, Hydro and Places catalogs',()=>{
  const selected=validateMapProjectManifest(JSON.parse(
    readFileSync(new URL('../../../projects/default-world/manifest.json',import.meta.url),'utf8')));
  const pin=libraryConfig(root);
  const archive=JSON.parse(git(libraryCheckout(root),['show',pin.revision+':archive/index.json']));
  const evidence={libraryRevision:pin.revision,project:selected.projectId,verified:[]};
  for(const role of ['terrain','rivers','places']){
    const path=mapProjectResourcePath(selected,role),spec=archive.files[path];
    assert.ok(spec,'Current project catalog missing in pinned archive: '+path);
    assert.match(spec.sha256,/^[a-f0-9]{64}$/);
    const bytes=readLibraryDataFile(path,{root});
    assert.equal(bytes.byteLength,spec.bytes,role+' pinned catalog byte count');
    assert.equal(sha256(bytes),spec.sha256,role+' pinned catalog SHA-256');
    const manifest=JSON.parse(bytes.toString('utf8'));
    if(role==='terrain'){
      validateTerrainManifest(manifest);
      assert.equal('v'+manifest.version,path.split('/').at(-2));
    }else if(role==='places'){
      validatePlaceManifest(manifest);
    }
    evidence.verified.push({role,path,bytes:bytes.length,sha256:spec.sha256});
  }
  console.log('P1_PINNED_CATALOG_INTEGRITY '+JSON.stringify(evidence));
});

test('the published Core WASM pair is source-, ABI- and compiler-pinned',()=>{
  const status=wasmStatus(root);
  assert.equal(status.needed,false,'Current Core pair mismatch: '+JSON.stringify(status.reasons));
  assert.match(status.sourceSha256,/^[a-f0-9]{64}$/);
  console.log('P1_PINNED_WASM_INTEGRITY '+JSON.stringify({
    sourceSha256:status.sourceSha256,needed:status.needed,
  }));
});
