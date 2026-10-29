import test from 'node:test';
import assert from 'node:assert/strict';
import {handleEditorMapClick} from '../../apps/editor/frontend/js/modules/editor-map-click.js';

for (const [tool,domain] of [['merge-territorial-unit','territorial'],['merge-generic-feature','generic']]) {
  test(`${tool} resolves the clicked object through geographic picking`,async()=>{
    const selected=[],state={tool,layerVisibility:{objects:true}},deps={
      projectState:{state},mapView:{screenToGeo:()=>[2,3]},platform:{d3:{event:{}}},
      objectPicking:{selectableObjectsAt:async()=>[{domain:'territorial',id:'T'},{domain:'generic',id:'G'}]},
      territorialModel:{entityRepository:{get:()=>({properties:{entityKind:'general',parentId:'parent'}})}},
      domains:{projectDomain:{getGeneration:()=>1}},mapLayout:{viewRevision:1},
      territorialEditingB:{toggleTerritorialUnitMergeTarget:id=>selected.push(id)},
      genericEditingB:{toggleGenericFeatureMergeTarget:id=>selected.push(id)},
      territorySelectionB:{territorySelectionCountryPickingActive:()=>false},
      surfaces:{isGenericFeatureDraftTool:()=>false},
    };
    await handleEditorMapClick([10,20],deps);
    assert.deepEqual(selected,[domain==='territorial'?'T':'G']);
  });
}

test('a merge target resolved after the tool changes is ignored',async()=>{
  let resolve;const selected=[],state={tool:'merge-generic-feature'},deps={
    projectState:{state},mapView:{screenToGeo:()=>[2,3]},platform:{d3:{event:{}}},
    objectPicking:{selectableObjectsAt:()=>new Promise(done=>{resolve=done;})},
    domains:{projectDomain:{getGeneration:()=>1}},mapLayout:{viewRevision:1},
    genericEditingB:{toggleGenericFeatureMergeTarget:id=>selected.push(id)},
  };
  const pending=handleEditorMapClick([10,20],deps);state.tool='select';
  resolve([{domain:'generic',id:'old'}]);await pending;
  assert.deepEqual(selected,[]);
});
