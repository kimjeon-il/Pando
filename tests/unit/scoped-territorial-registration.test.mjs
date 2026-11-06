import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTerritorialStorageScope} from '../../tools/library-data.mjs';
const base='assets/data/territorial-entities';
const old={entities:[{entityId:'state:kept',lineageId:'a',file:'state-kept.json.gz',sha256:'same'}],lineages:[{schemaVersion:2,lineageId:'a',names:{en:'A'},entityRefs:['state:kept'],relations:[]}]};
function fixture(){const next=structuredClone(old);next.entities.push({entityId:'state:new',lineageId:'a',file:'state-new.json.gz',sha256:'new'});next.lineages[0].entityRefs.push('state:new');return{next,paths:[base+'/generated/v2/index.json',base+'/generated/v2/state-new.json.gz',base+'/source/countries/state-new.json',base+'/source/lineages/a.json']};}
const options=next=>({readLineage:id=>structuredClone(next.lineages.find(row=>row.lineageId===id))});
test('scoped registration requires the new source, chunk, index and exact lineage source together',()=>{
 const{next,paths}=fixture();assert.doesNotThrow(()=>assertTerritorialStorageScope(paths,next,old,options(next)));
 for(let i=0;i<paths.length;i++)assert.throws(()=>assertTerritorialStorageScope(paths.filter((_,j)=>i!==j),next,old,options(next)));
 assert.throws(()=>assertTerritorialStorageScope(paths,next,old,{readLineage:()=>old.lineages[0]}),/lineage/i);
});
test('scoped registration preserves existing membership and rejects orphan, duplicate or unselected edits',()=>{
 const{next,paths}=fixture();
 for(const mutate of [n=>n.entities.shift(),n=>n.entities.push(n.entities[1]),n=>n.lineages[0].entityRefs.pop(),n=>n.lineages[0].entityRefs.push('state:new'),n=>n.entities[0].sha256='changed']){
  const bad=structuredClone(next);mutate(bad);assert.throws(()=>assertTerritorialStorageScope(paths,bad,old,options(bad)));
 }
});
