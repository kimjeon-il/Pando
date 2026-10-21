import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildBuiltinWorldPublication,writeBuiltinWorldPublication} from '../../tools/build-builtin-world.mjs';
import {historicalWorldCases} from '../fixtures/historical-world-cases.mjs';
import {withExplicitView} from '../helpers/builtin-world.mjs';
test('country publication is deterministic, has no aggregate project and detects stale output',()=>{
 const input=withExplicitView(historicalWorldCases());
 const first=buildBuiltinWorldPublication({input}),second=buildBuiltinWorldPublication({input});
 assert.deepEqual(first,second);assert.equal(first.has('world-project.json.gz'),false);
 const index=JSON.parse(first.get('index.json'));assert.equal(Object.hasOwn(index,'sourceMonth'),false);
 for(const row of index.entities)assert.equal(first.get(row.file)[9],3);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'builtin-country-publication-'));
 writeBuiltinWorldPublication(first,folder);writeBuiltinWorldPublication(second,folder,{check:true});
 fs.appendFileSync(path.join(folder,'index.json'),'stale');
 assert.throws(()=>writeBuiltinWorldPublication(first,folder,{check:true}),/stale/i);
});
test('country publication rejects a missing policy',()=>{
 assert.throws(()=>buildBuiltinWorldPublication({policyFile:path.join(os.tmpdir(),'missing-history-policy.json')}),/ENOENT|missing/i);
});
