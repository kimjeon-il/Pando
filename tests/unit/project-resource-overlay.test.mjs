import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectResourceOverlay} from '../../shared/frontend/js/modules/project-resource-overlay.js';
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createTerritorialLabels} from '../../shared/frontend/js/modules/territorial-labels.js';
import {normalizePlace} from '../../shared/frontend/js/modules/place-contract.js';

const id='22000000-0000-4000-8000-000000000001';
const placeId='builtin:place:synthetic:seoul';
const place=()=>normalizePlace({source:'synthetic',sourceId:'seoul',name:'서울',kind:'capital',coordinates:[127,37]});
const label=()=>({id,sourcePlaceId:placeId,name:'작성 서울',kind:'capital',coordinates:[127,37]});
const sourceRiver={id:'fragment:1',properties:{pandolab_id:'river:logical',category:'river',layer_id:'rivers'},
 geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}};
const sourceLake={id:'lake:source',properties:{pandolab_id:'lake:source',category:'lake',layer_id:'lakes'},
 geometry:{type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]}};
const riverCopy=()=>({type:'Feature',id:'copy:river',geometry:null,
 properties:{pandolab_domain:'hydro',category:'river',sourceFeatureId:'river:logical'}});
const lakeCopy=()=>({type:'Feature',id:'copy:lake',geometry:null,
 properties:{pandolab_domain:'hydro',category:'lake',sourceFeatureId:'lake:source'}});

test('P4 C++ territorial identities are one project-owned catalog, not a second builtin writer',()=>{
 const root={id:'A',properties:{name:'Accepted'}};
 const resources=projectResourceOverlay('territorial',[root]);
 assert.deepEqual(resources.records,[root]);
 assert.equal(resources.findById('A'),root);
 assert.equal(resources.ownerOf('A'),'project');
 assert.equal(resources.ownerOf('missing'),null);
 assert.deepEqual(resources.replacedSourceIds,[]);
 assert.throws(()=>projectResourceOverlay('territorial',[root],[{id:'source'}]),/C\+\+ project/);
});

test('P4 project labels replace only referenced builtin places and keep unmodified names independent',()=>{
 const authored=label(),builtin=place();
 const independent=normalizePlace({source:'synthetic',sourceId:'busan',name:'부산',kind:'city',coordinates:[129,35]});
 const reference=Object.freeze([builtin,independent,builtin]);
 const view=projectResourceOverlay('label',[authored],reference);
 assert.deepEqual(view.project,[authored]);
 assert.deepEqual(view.library,[independent]);
 assert.deepEqual(view.records,[authored,independent]);
 assert.equal(view.sourceReplacement(placeId),authored);
 assert.equal(view.isSourceReplaced(placeId),true);
 assert.equal(view.findById(authored.id),authored);
 assert.equal(view.findById(placeId),null);
 assert.equal(view.ownerOf(authored.id),'project');
 assert.equal(view.ownerOf(independent.id),'library');
 assert.equal(view.ownerOf(placeId),null);
 assert.equal(reference.length,3);
 assert.equal(builtin.name,'서울');
 assert.equal(authored.name,'작성 서울');
});

test('P4 hydro source refs unify rivers and lakes without copying source geometries',()=>{
 const river=riverCopy(),lake=lakeCopy(),references=[sourceRiver,sourceLake];
 const source=structuredClone(references);
 const edited=projectResourceOverlay('hydro',[river,lake],references);
 assert.deepEqual(edited.records,[river,lake]);
 assert.deepEqual(edited.replacedSourceIds,['river:logical','lake:source']);
 assert.equal(edited.sourceReplacement('river:logical'),river);
 assert.equal(edited.sourceReplacement('lake:source'),lake);
 assert.equal(edited.findById('river:logical'),null);
 assert.deepEqual(references,source,'reference bytes remain untouched');
 const original=projectResourceOverlay('hydro',[],references);
 assert.equal(original.records.length,2);
 assert.equal(original.findById('river:logical'),sourceRiver);
 assert.equal(original.findById('lake:source'),sourceLake);
 assert.equal(original.ownerOf('river:logical'),'library');
});

test('P4 different project revisions never share replacement state or mutable catalogs',()=>{
 const empty=projectResourceOverlay('label',[],[place()]);
 const altered=projectResourceOverlay('label',[label()],[place()]);
 assert.equal(empty.records.length,1);
 assert.equal(altered.records.length,1);
 assert.equal(empty.isSourceReplaced(placeId),false);
 assert.equal(altered.isSourceReplaced(placeId),true);
 assert.ok(Object.isFrozen(empty.records));
 assert.ok(Object.isFrozen(altered.project));
 assert.ok(Object.isFrozen(altered.replacedSourceIds));
 assert.throws(()=>{altered.project.push({id:'new'});},TypeError);
});

test('P4 original source identity and project ID must never merge across domains',()=>{
 const shared='same:literal-id';
 const placeView=projectResourceOverlay('label',[{id:'project:place',sourcePlaceId:shared}],[{id:shared}]);
 const waterView=projectResourceOverlay('hydro',[],[{id:shared,properties:{category:'river'}}]);
 assert.equal(placeView.isSourceReplaced(shared),true);
 assert.equal(waterView.isSourceReplaced(shared),false);
 assert.equal(waterView.ownerOf(shared),'library');
 assert.equal(placeView.ownerOf('project:place'),'project');
});

test('P4 duplicate authored IDs and unsupported pseudo-domains fail before indexing',()=>{
 assert.throws(()=>projectResourceOverlay('label',[{id:'A'},{id:'A'}]),/Duplicate authored/);
 assert.throws(()=>projectResourceOverlay('hydro',[{id:''}]),/literal object ID/);
 assert.throws(()=>projectResourceOverlay('placeBuiltin',[]),/Unknown/);
 assert.throws(()=>projectResourceOverlay('hydro',{},[]),/explicit arrays/);
 assert.throws(()=>projectResourceOverlay('label',[],[{}]),/literal object ID/);
});

test('P4 multiple authored variants preserve all user records and the original first-replacement rule',()=>{
 const first=riverCopy(),second={...riverCopy(),id:'copy:river2'};
 const view=projectResourceOverlay('hydro',[first,second],[sourceRiver]);
 assert.deepEqual(view.records,[first,second]);
 assert.equal(view.sourceReplacement('river:logical'),first);
 assert.equal(view.isSourceReplaced('river:logical'),true);
 assert.equal(view.findById(second.id),second);
});

test('P4 selected but copied builtin places cannot reappear through the label lookup owner',t=>{
 const source=place(),authored=label(),state={labels:[authored],timelineCursor:'2026-10'};
 const owner=createTerritorialLabels();
 owner.connect({projectState:{state},
  platform:{runtimeAssetUrl:()=>new URL('https://example.invalid/data/places/manifest.json')},
  preferences:{userPreferences:{labels:{place:{languages:{ko:true,en:false,native:false}}}}},
  domains:{projectDomain:{admitSelectionCatalog:async()=>true},selectionDomain:{snapshot:()=>({selection:{items:[],primaryKey:null}})},
   objectSearchController:{render(){}},renderingDomain:{invalidateLabels(){}}},
  feedback:{reportOperationError(){}},
 });
 owner.initializeLabelLayoutMetrics();
 t.after(()=>owner.builtinPlaces.dispose());
 owner.builtinPlaces.retain(source);
 assert.equal(owner.labelById(authored.id),authored);
 assert.equal(owner.labelById(source.id),null);
 state.labels=[];
 assert.equal(owner.labelById(source.id),source);
 assert.equal(owner.labelById(authored.id),null);
});

test('P4 accepted C++ world snapshots remain the sole territorial and water project source',async t=>{
 const seed=JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json',import.meta.url)));
 const owner=await createNodeCoreProject(seed,{productMode:'viewer'});
 t.after(()=>owner.dispose());
 const original=owner.documentModel.snapshot(),territory=owner.documentModel.territorialViews();
 const hydro=owner.documentModel.list('hydro');
 const projectRegions=projectResourceOverlay('territorial',territory);
 const projectWater=projectResourceOverlay('hydro',hydro);
 assert.strictEqual(projectRegions.findById(territory[0].id),territory[0]);
 assert.strictEqual(projectWater.findById(hydro[0].id),hydro[0]);
 assert.equal(projectWater.records[0].properties.category,'river');
 assert.equal(original.hydroEdits[0].geometry,null);
 assert.deepEqual(owner.documentModel.snapshot(),original,'pure overlays do not modify C++ storage');
 await owner.client.setTimelineCursor('2025-12');
 assert.deepEqual(owner.documentModel.snapshot(),original,'session month is not part of the stored project');
});
