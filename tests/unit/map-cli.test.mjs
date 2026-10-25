import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec=promisify(execFile),cli=fileURLToPath(new URL('../../plugins/pando-map-tools/scripts/map.mjs',import.meta.url));
async function failure(args) {
  try {await exec(process.execPath,[cli,...args],{maxBuffer:2000000});assert.fail('Expected CLI rejection');}
  catch(error) {assert.equal(error.code,1);return JSON.parse(error.stderr.trim());}
}
test('analyze rejects conflicting file and source inputs before loading a runtime',async()=>{
  const result=await failure(['analyze','--input','map.png','--source','source.json','--job','unused.json']);
  assert.match(result.message,/exactly one.*--input.*--source/i);
});
test('missing selected workspace fails inside the operation error boundary',async()=>{
  const result=await failure(['analyze','--input','map.png','--job','unused.json','--workspace','/unavailable-map-workspace']);
  assert.equal(result.code,'PL-MAP-RESOURCE');assert.match(result.message,/workspace.*unavailable/i);
});
