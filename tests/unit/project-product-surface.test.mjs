import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectDomain} from "../../shared/frontend/js/modules/project-domain.js";

test('project domains require explicit product mode and only editors register mutation/persistence APIs',()=>{
 assert.throws(()=>createProjectDomain({}),/product mode/i);
 const options={commandOwner:{state:()=>({epoch:1})},documentModel:{snapshot:()=>({}),projectWorld:value=>value}};
 for(const productMode of ['viewer','editor']){
  const domain=createProjectDomain({productMode,...options});
  for(const key of ['snapshot','state','resolveWorld','open','load','getGeneration','admitSelectionCatalog','admitPresentationCatalog','dispose'])assert.equal(typeof domain[key],'function',key);
  for(const key of ['createProject','executeCommand','prepareCommand','confirmCandidate','cancelCandidate','labelGestureApply','save','undo','redo','buildFileSnapshot','buildAutosave'])assert.equal(key in domain,productMode==='editor',key);
  for(const key of ['configureProject','comparisonMonth','comparisonHighlight','comparisonResult','setComparisonMonth','resolveComparison','highlightComparison'])assert.equal(key in domain,false,key);
 }
});
