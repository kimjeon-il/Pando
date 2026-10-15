import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const cases=JSON.parse(readFileSync(new URL('../native/tests/fixtures/web-m97/cut-corpus.json',import.meta.url),'utf8'));
const output=execFileSync(process.argv[2],[],{input:cases.map(c=>JSON.stringify(c.payload)).join('\n')+'\n',encoding:'utf8',maxBuffer:16*1024*1024,timeout:15000}).trim().split('\n').map(JSON.parse);
assert.equal(output.length,cases.length);
for(let i=0;i<cases.length;i++)assert.deepEqual(output[i],cases[i].result,cases[i].id);
console.log(`${cases.length} shared C++ cut results match the frozen browser corpus.`);
