import assert from 'node:assert/strict';
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
  assert.deepEqual(rows.map(row=>[classifyLSIBExclusion(row,false),classifyLSIBExclusion(row,true)]),[[null,'existing-disputed-territory-or-protected-country-pair'],
    ['special-or-separation-line','special-or-separation-line'],
    ['river-island-sovereignty-needs-independent-review','existing-disputed-territory-or-protected-country-pair']]);
  assert.throws(()=>classifyLSIBExclusion(null,false),/properties/i);
});
