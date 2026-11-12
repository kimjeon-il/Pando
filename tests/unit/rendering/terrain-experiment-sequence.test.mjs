import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateSequence} from '../../../scripts/terrain-experiment/candidate-sequence.mjs';

test('current renderer is included once in smoke and three times in the balanced full experiment',()=>{
  const smoke=candidateSequence({smoke:true,cog:true,screen:true});
  assert.deepEqual(smoke,['a0','a1','b512','cog','screen']);
  const full=candidateSequence({smoke:false,cog:true,screen:true});
  assert.equal(full.length,15);
  for(const name of smoke)assert.equal(full.filter(candidate=>candidate===name).length,3);
  assert.notDeepEqual(full.slice(0,5),full.slice(5,10));
  assert.deepEqual(candidateSequence({smoke:true,cog:true,screen:true,only:'a0'}),['a0']);
  assert.throws(()=>candidateSequence({smoke:true,only:'cog'}),/unavailable/);
});
