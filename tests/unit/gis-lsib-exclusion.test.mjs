import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {classifyLSIBExclusion} from '../../tools/gis/lsib-exclusion.mjs';

const ordinary={RANK:'1',STATUS:'International Boundary',NOTES:''};
test('LSIB special lines and disputed or uncertain ownership are withheld in the original order',()=>{
  const cases=[
    [ordinary,false,null],[ordinary,true,'existing-disputed-territory-or-protected-country-pair'],
    [{...ordinary,RANK:'2'},true,'special-or-separation-line'],
    [{...ordinary,STATUS:'Line of Control'},false,'special-or-separation-line'],
    ...['Uncertain alignment','Condominium','neutral zone','Invernada'].map(NOTES=>[{...ordinary,NOTES},false,'uncertain-or-joint-sovereignty']),
    [{...ordinary,NOTES:'River island sovereignty disputed'},false,'river-island-sovereignty-needs-independent-review'],
    [{...ordinary,NOTES:'Uncertain island sovereignty'},false,'uncertain-or-joint-sovereignty'],
  ];
  for(const [properties,disputed,expected] of cases)assert.equal(classifyLSIBExclusion(properties,disputed),expected);
  assert.throws(()=>classifyLSIBExclusion({...ordinary,NOTES:null},false),/note/i);
});
test('batch classification preserves source order and rejects malformed requests',()=>{
  const rows=[ordinary,{...ordinary,RANK:'2'},{...ordinary,NOTES:'island sovereignty'}];
  const call=input=>spawnSync(process.execPath,['tools/gis/lsib-exclusion.mjs','--stream'],{input,encoding:'utf8',windowsHide:true});
  const good=call(JSON.stringify(rows));assert.equal(good.status,0,good.stderr);
  assert.deepEqual(JSON.parse(good.stdout),[[null,'existing-disputed-territory-or-protected-country-pair'],
    ['special-or-separation-line','special-or-separation-line'],
    ['river-island-sovereignty-needs-independent-review','existing-disputed-territory-or-protected-country-pair']]);
  assert.notEqual(call('not-json').status,0);
});
