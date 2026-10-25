import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationFunctionSource } from '../../scripts/lib/application-source.mjs';

test('Node application source parser preserves a multiline owner and nested body',()=>{
  const source = `export async function operation({
  defaults = {},
}) {
  if(defaults.enabled){
    return { result: true };
  }
  return { result: false };
}
function following(){ return null; }`;
  const owner=applicationFunctionSource(source,'operation');
  assert.ok(owner.includes('return { result: false };'));
  assert.ok(owner.startsWith('export async function operation('));
  assert.doesNotMatch(owner,/following/);
  assert.throws(()=>applicationFunctionSource(source,'missing'),/Missing application function/);
});
