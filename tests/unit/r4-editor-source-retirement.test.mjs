import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const exists=p=>existsSync(resolve(root,p));
const report=JSON.parse(readFileSync(resolve(root,'docs/development/r4-source-pruning.json'),'utf8'));
test('R4 removed obsolete editor sources and tests are absent',()=>{
 assert.equal(report.schema,'pandolab-r4-source-pruning-v1');
 assert.equal(report.removedSourceCount,45);
 assert.equal(report.removedTestCount,10);
 for(const path of [...report.removedSources,...report.removedTests])
   assert.equal(exists(path),false,'Retired source or unit test reappeared: '+path);
});
test('R4 preserves GIS and C++ serializer contracts outside the legacy editor',()=>{
 for(const name of ['territorial-library','territorial-index-entry','project-serializer',
   'exchange-adapter-registry','cut-worker-preparation',
   'river-territory-partition','polygon-clipping-calculation','timeline-edit',
   'territorial-geometry','territorial-library-provenance'])
   assert.equal(exists('tools/gis/'+name+'.js'),true,'Canonical GIS contract missing: '+name);
 assert.equal(exists('shared/frontend/js/modules/generic-feature-normalization.js'),true,
   'Canonical v2 feature normalization must be independent of old GIS mutation commands');
 assert.equal(exists('tests/helpers/generic-feature-command-service.mjs'),true,
   'Legacy Core command adapter must be test-owned');
 assert.equal(exists('tools/gis/generic-feature-service.js'),false,
   'The old GIS data+editor-command mixed service must not remain');
 const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
 assert.doesNotMatch(pkg.scripts['check:domains'],/apps\/editor\/frontend/);
 const source=readFileSync(resolve(root,'apps/editor/native-contract.mjs'),'utf8');
 assert.doesNotMatch(source,/['"]apps\/editor\/frontend\/js\/modules\/project-serializer\.js['"]/);
});
