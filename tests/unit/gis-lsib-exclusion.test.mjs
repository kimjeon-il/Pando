import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
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
test('Python supplement caller uses the same batched exclusion policy',{
  skip:!process.env.PANDO_PYTHON_ORACLE
},async()=>{
  const index=JSON.parse(await readFile('tools/historical-library/sources/lsib-11.4/line-index.json','utf8'));
  const ids=['c133c4d6-bf4f-489d-b51e-abf2be55d369','4990410a-4158-4932-8445-90397c840a87'];
  const rows=ids.map(id=>{const row=index.find(value=>value.properties.ID===id);assert.ok(row,id);return row.properties;});
  rows.push(ordinary,{...ordinary,RANK:'2'},{...ordinary,STATUS:'Line of Control'},
    ...['Uncertain alignment','Condominium','neutral zone','Invernada','island sovereignty','Uncertain island sovereignty'].map(NOTES=>({...ordinary,NOTES})));
  const script=`import importlib.util,json,sys\nspec=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nrecords=[{'properties':p} for p in json.load(sys.stdin)]\nresult=m.exclusion_reasons(records)\nprint(json.dumps([result[id(r)] for r in records]))`;
  const original=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(rows),encoding:'utf8',windowsHide:true});
  assert.equal(original.status,0,original.stderr);
  assert.deepEqual(rows.map(row=>[classifyLSIBExclusion(row,false),classifyLSIBExclusion(row,true)]),JSON.parse(original.stdout));
});
