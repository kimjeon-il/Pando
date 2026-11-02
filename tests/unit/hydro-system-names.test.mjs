import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createHydroSystemNamer} from '../../tools/gis/hydro-system-names.mjs';

const replacements=JSON.parse(readFileSync('tools/gis/hydro-independent-name-replacements.json','utf8'));
const document={schemaVersion:1,replacements:[replacements.replacements[0]]};
test('system names preserve reviewed precedence, source IDs and tributary names',()=>{
  const name=createHydroSystemNamer({aliases:{'Reviewed':'검토강'},systemOverrides:{},independentDocument:{schemaVersion:1,replacements:[]}});
  const result=name({systemId:42,chainIndexes:[0,1],mainstemIndex:0,neNames:{0:'Yalu River',1:'Reviewed'},
    osmByChain:{0:{id:7,nameKo:'임의 강',names:['Other River']},1:{id:8,nameKo:'작은 강',names:['Other River']}}});
  assert.deepEqual(result,{displayName:'검토강',nameEnriched:true,aliases:['Other','Yalu'],
    tributaryNames:['작은강'],osmRelationIds:[7,8],independent:false});
});
test('independent review replaces OSM names without consulting the OSM input',()=>{
  const name=createHydroSystemNamer({aliases:{},systemOverrides:{},independentDocument:document});
  const input={systemId:Number(document.replacements[0].systemId),chainIndexes:[0],mainstemIndex:0,neNames:{0:'Nile River'}};
  Object.defineProperty(input,'osmByChain',{get(){throw Error('OSM must not be consulted');}});
  const result=name(input);assert.equal(result.displayName,document.replacements[0].nameKo);
  assert.deepEqual(result.aliases,[...document.replacements[0].aliases].sort());
  assert.deepEqual(result.tributaryNames,[...document.replacements[0].tributaryNames].sort());
  assert.deepEqual(result.osmRelationIds,[]);assert.equal(result.independent,true);
});
test('independent aliases preserve repeated entries exactly as the verified document',()=>{
  const repeated=structuredClone(document);repeated.replacements[0].aliases.push(repeated.replacements[0].aliases[0]);
  const name=createHydroSystemNamer({aliases:{},systemOverrides:{},independentDocument:repeated});
  const result=name({systemId:Number(repeated.replacements[0].systemId),chainIndexes:[0],mainstemIndex:0,neNames:{}});
  assert.deepEqual(result.aliases,[...repeated.replacements[0].aliases].sort());
});
test('validated independent evidence and aliases cannot change after creating the namer',()=>{
  const source=structuredClone(document),aliases={Reviewed:'검토강'},systemOverrides={};
  const name=createHydroSystemNamer({aliases,systemOverrides,independentDocument:source});
  source.replacements[0].nameKo='변조강';source.replacements[0].aliases[0]='변조';aliases.Reviewed='변조강';
  const result=name({systemId:Number(document.replacements[0].systemId),chainIndexes:[0],mainstemIndex:0,neNames:{}});
  assert.equal(result.displayName,document.replacements[0].nameKo);assert.deepEqual(result.aliases,document.replacements[0].aliases);
});
test('unnamed systems and malformed provenance are explicit',()=>{
  const name=createHydroSystemNamer({aliases:{},systemOverrides:{},independentDocument:{schemaVersion:1,replacements:[]}});
  assert.deepEqual(name({systemId:42,chainIndexes:[0],mainstemIndex:0,neNames:{},osmByChain:{}}),
    {displayName:'미명명 수계 42',nameEnriched:false,aliases:[],tributaryNames:[],osmRelationIds:[],independent:false});
  assert.throws(()=>createHydroSystemNamer({aliases:{},systemOverrides:{},independentDocument:{schemaVersion:2,replacements:[]}}),/schema/i);
});
test('system overrides take precedence and aliases use Python Unicode code point order',()=>{
  const name=createHydroSystemNamer({aliases:{},systemOverrides:{42:{nameKo:'정식 강',aliases:['😀','\ue000']}},
    independentDocument:{schemaVersion:1,replacements:[]}});
  const result=name({systemId:42,chainIndexes:[0],mainstemIndex:0,neNames:{0:'Other River'},osmByChain:{}});
  assert.equal(result.displayName,'정식강');assert.deepEqual(result.aliases,['Other','\ue000','😀']);
});
