import { describe as contractSuite } from 'node:test';
import * as __merge_dep0 from "node:test";
import * as __merge_dep1 from "node:assert/strict";
import * as __merge_dep2 from "../../../src/ui/user-preferences.js";
import * as __merge_dep3 from "../../../src/ui/app-accent.js";
import * as __merge_dep4 from "../../../src/ui/accent-presets.js";
import * as __merge_dep5 from "../../../src/map/map-interaction-style.js";
import * as __merge_dep6 from "node:fs";
import * as __merge_dep7 from "../../../src/document/core-document-read-model.js";
import * as __merge_dep8 from "../../../src/ui/map-workspace-host.js";
import * as __merge_dep9 from "../../../src/rendering/render-quality.js";
import * as __merge_dep10 from "../../../src/document/territorial-entity-store.js";
import * as __merge_dep11 from "../../../src/geometry/geometry-version-store.js";
import * as __merge_dep12 from "../../../src/ui/physical-settings.js";
contractSuite("user-preferences", () => {
const { describe : contractSuite } = __merge_dep0;
const __unit_dep0 = __merge_dep0;
const __unit_dep1 = __merge_dep1;
const __unit_dep2 = __merge_dep2;
const __unit_dep3 = __merge_dep3;
const __unit_dep4 = __merge_dep4;
const __unit_dep5 = __merge_dep5;
contractSuite("user-preferences", () => {
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { defaultUserPreferences, normalizeUserPreferences } = __unit_dep2;

test('background preferences contain no separate source visibility switches', () => {
  const normalized = normalizeUserPreferences({ version: 2, backgrounds: { viewer: { builtinHydro: false, builtinPlaces: false } } });
  for (const settings of [...Object.values(defaultUserPreferences().backgrounds), ...Object.values(normalized.backgrounds)]) {
    assert.equal(Object.hasOwn(settings, 'builtinHydro'), false);
    assert.equal(Object.hasOwn(settings, 'builtinPlaces'), false);
  }
});

test('selection defaults to the active theme accent and invalid custom colors reset to default', () => {
  assert.equal(defaultUserPreferences().selection.color, null);
  assert.equal(normalizeUserPreferences({ version: 2, selection: { color: '', fillStrength: 0.35 } }).selection.color, null);
  assert.equal(normalizeUserPreferences({ version: 2, selection: { color: 'green', fillStrength: 0.35 } }).selection.color, null);
});

test('current preferences retain only label and composable selection settings', () => {
  const preferences = normalizeUserPreferences({
    version: 2,
    appearance: { theme: 'dark' },
    labels: { country: { font: 'serif', color: '#Aa11Bb' }, place: { font: 'gothic', color: '#123456', pointColor: '#abcdef', showNativeNames: false } },
    selection: { color: '#0f1e2d', outlineVisible: false, fillStrength: 0.6 },
  });
  assert.deepEqual(preferences, {
    backgrounds:defaultUserPreferences().backgrounds,version: 2,
    timeline:{defaultWorldFollowCurrentMonth:true},
    appearance: { theme: 'dark', accentPreset: 'blue', smoothLines: true },
    labels: { country: { font: 'serif', color: '#aa11bb' }, place: { font: 'gothic', color: '#123456', pointColor: '#abcdef', showNativeNames: false } },
    selection: { color: '#0f1e2d', outlineVisible: false, fillStrength: 0.6 },
  });
});

test('default-world follows the current month by preference without changing user-file dates',()=>{
  assert.deepEqual(defaultUserPreferences().timeline,{defaultWorldFollowCurrentMonth:true});
  assert.equal(normalizeUserPreferences({version:2,timeline:{defaultWorldFollowCurrentMonth:false}})
    .timeline.defaultWorldFollowCurrentMonth,false);
  assert.equal(normalizeUserPreferences({version:2,timeline:{defaultWorldFollowCurrentMonth:'false'}})
    .timeline.defaultWorldFollowCurrentMonth,true);
  assert.equal(normalizeUserPreferences({version:1,timeline:{defaultWorldFollowCurrentMonth:false}})
    .timeline.defaultWorldFollowCurrentMonth,true);
});

test('retired editor status bar setting is omitted from Viewer preferences', () => {
  assert.equal(Object.hasOwn(defaultUserPreferences().appearance,'statusBarVisible'),false);
  assert.equal(Object.hasOwn(normalizeUserPreferences({version:2,appearance:{statusBarVisible:false}}).appearance,'statusBarVisible'),false);
});

test('invisible selection combinations restore an outline and old schema values are ignored', () => {
  const preferences = normalizeUserPreferences({ version: 1, selection: { mode: 'strong-fill', outlineVisible: false, fillStrength: 0 } });
  assert.equal(preferences.selection.outlineVisible, true);
  assert.equal(preferences.selection.fillStrength, defaultUserPreferences().selection.fillStrength);
  assert.deepEqual(preferences.labels, defaultUserPreferences().labels);
});

test('native-name overlay is the only place-language preference and defaults off', () => {
  const defaults = defaultUserPreferences().labels.place;
  assert.equal(defaults.showNativeNames, false);
  assert.equal(Object.hasOwn(defaults, 'languages'), false);
  const enabled = normalizeUserPreferences({ version: 2, labels: { place: { showNativeNames: true } } });
  assert.equal(enabled.labels.place.showNativeNames, true);
  assert.equal(Object.hasOwn(enabled.labels.place, 'languages'), false);
  const disabled = normalizeUserPreferences({ version: 2, labels: { place: { showNativeNames: 'true' } } });
  assert.equal(disabled.labels.place.showNativeNames, false);
  const oldSwitches = normalizeUserPreferences({ version: 2, labels: { place: { languages: { ko: false, en: true, native: true } } } });
  assert.deepEqual(oldSwitches.labels.place, defaults, 'retired English/standalone native map switches cannot persist');
});
});
contractSuite("app-accent", () => {
const test = __unit_dep0.default;
const assert = __unit_dep1.default;
const { accentTokens } = __unit_dep3;
const { resolveAccentPreset } = __unit_dep4;
const { normalizeUserPreferences, saveUserPreferences } = __unit_dep2;
const { resolveMapInteractionStyle } = __unit_dep5;

test('accent preset normalizes independently from preserved label and selection settings', () => {
  for (const value of [undefined, null, 'invalid', '#123', '#123456ff']) assert.equal(normalizeUserPreferences({ version: 2, appearance: { accentPreset: value } }).appearance.accentPreset, 'blue');
  const input = normalizeUserPreferences({ version: 2, appearance: { theme: 'light', accentPreset: 'purple' }, labels: { country: { font: 'serif', color: '#123456' } }, selection: { color: '#ff0000', fillStrength: 0.8 } });
  assert.equal(input.appearance.accentPreset, 'purple');
  const changed = saveUserPreferences({ ...input, appearance: { ...input.appearance, accentPreset: 'pink' } }, { setItem() {} });
  assert.equal(changed.appearance.accentPreset, 'pink');
  assert.deepEqual(changed.labels, input.labels); assert.deepEqual(changed.selection, input.selection);
});

test('accent presets resolve to an appropriate color for each theme', () => {
  assert.equal(resolveAccentPreset('blue', 'light'), '#316fd3');
  assert.equal(resolveAccentPreset('blue', 'dark'), '#70a6ff');
  assert.equal(resolveAccentPreset('missing', 'dark'), null);
});

test('changing accent preserves every non-color interaction rule', () => {
  for (const theme of ['light', 'dark']) {
    const before = resolveMapInteractionStyle({ theme, selectionColor: '#4f8cff' });
    const after = resolveMapInteractionStyle({ theme, selectionColor: '#d9468f' });
    assert.equal(after.selection.color, '#d9468f');
    assert.notEqual(after.hover.color, before.hover.color);
    const withoutColors = style => ({ ...style, hover: { ...style.hover, color: null }, selection: { ...style.selection, color: null } });
    assert.deepEqual(withoutColors(after), withoutColors(before));
  }
});

test('accent tokens retain chosen hue and always use white button text', () => {
  assert.equal(accentTokens('#ffffff')['accent-text'], '#ffffff');
  assert.equal(accentTokens('#000000')['accent-text'], '#ffffff');
  assert.equal(accentTokens('#8b5cf6').accent, '#8b5cf6');
  assert.ok(!('danger' in accentTokens('#8b5cf6')));
});
});
});
contractSuite("shared-view-policy", () => {
const test = __merge_dep0.default;
const { readFileSync } = __merge_dep6;
const { createCoreDocumentReadModel } = __merge_dep7;
const { createMapHost } = __merge_dep8;
const assert = __merge_dep1.default;
const { createRenderQuality } = __merge_dep9;
const { createTerritorialEntityStore } = __merge_dep10;
const { createGeometryVersionStore } = __merge_dep11;
const { createHydroSettings } = __merge_dep12;

test('terrain intents retain the last enabled mode and reject unknown modes',()=>{
 const settings={terrainVisible:true,terrainStyle:'physical',hydroLayers:{rivers_hydro:false}};
 const physical=createHydroSettings();physical.connect({projectState:{state:{physicalSettings:settings}}});
 assert.deepEqual(physical.terrainModeSettings('none'),{...settings,terrainVisible:false});
 assert.equal(physical.terrainModeSettings('political').terrainStyle,'political');
 assert.throws(()=>physical.terrainModeSettings('unknown'),/Unknown terrain mode/);
 assert.equal(settings.terrainVisible,true);assert.equal(settings.terrainStyle,'physical');
});

test('the render quality owner applies preference style to every render consumer',()=>{
 const style={hover:{color:'#ff0088'},selection:{color:'#ff0088',outlineVisible:false,fillStrength:.8}};
 const calls=[];
 const quality=createRenderQuality();
 quality.connect({preferences:{resolvedInteractionStyle:style},selectionServices:{setSelectionInteractionStyle:value=>calls.push(['shared',value])},
  gpuRenderingA:{selectionPass:{updateStyle:value=>calls.push(['pass',value])}},
  rendering:{gpuMapRenderer:{setInteractionStyle:value=>calls.push(['renderer',value]),invalidateCountryPalette:(...args)=>calls.push(['palette',...args]),invalidatePhysicalStyle:reason=>calls.push(['physical',reason])}},
  domains:{renderingDomain:{invalidateSelectionStyle:reason=>calls.push(['selection',reason]),invalidateBaseScene:reason=>calls.push(['base',reason])}}});
 quality.applyMapAppearanceChange({reason:'preferences',rerender:true});
 assert.deepEqual(calls.slice(0,3),[['shared',style],['pass',style],['renderer',style]]);
 assert.ok(calls.some(([key])=>key==='selection'));assert.ok(calls.some(([key])=>key==='base'));
 calls.length=0;quality.applyMapAppearanceChange({reason:'preview',rerender:false});
 assert.ok(calls.some(([key])=>key==='renderer'));assert.ok(!calls.some(([key])=>key==='selection'||key==='base'));
});

test('the entity projection reports actual root shape changes separately from metadata and child changes',()=>{
 const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[0,0]]]};
 const admittedGeometry=version=>createGeometryVersionStore([{id:'shape:A',version,geojson:geometry}]).get({id:'shape:A',version});
 let rows=[{id:'A',geometry:admittedGeometry(1),properties:{entityKind:'general',parentId:'',name:'A'}}],transition;
 const changes=[];
 const store=createTerritorialEntityStore({documentModel:{territorialViews:()=>rows,list:()=>[],world:()=>({}),projectWorld:()=>({})},
  commandOwner:{state:()=>({}),subscribeTransitions:listener=>{transition=listener;return ()=>{};},resolveWorld(){},setTimelineCursor(){}},
  onEntitiesReplaced:(_rows,change)=>changes.push(change)});
 rows=[{...rows[0],properties:{...rows[0].properties,name:'renamed'}}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,false);
 rows=[{...rows[0],geometry:admittedGeometry(1)}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,false,'the same canonical geometry version must not rebuild because its allocation changed');
 rows=[{...rows[0],geometry:admittedGeometry(2)}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,true);
 rows=[...rows,{id:'B',geometry,properties:{entityKind:'general',parentId:'A'}}];transition();
 assert.equal(changes.at(-1).rootGeometryChanged,false);
 rows=rows.map(row=>row.id==='B'?{...row,properties:{...row.properties,parentId:''}}:row);transition();
 assert.equal(changes.at(-1).rootGeometryChanged,true);
 store.dispose();
});


test('replacing a document invalidates roots even when archive-local geometry references collide',()=>{
 const seed=JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json",import.meta.url),'utf8'));
 const model=createCoreDocumentReadModel(seed),binding=seed.timelineRecords.geometryBindings.find(row=>row.objectRef.domain==='territorial'&&row.objectRef.id==='A');
 const world={month:'2026-10',sourceEpoch:1,entities:[{objectRef:{domain:'territorial',id:'A'},geometryRef:binding.geometryRef,parentId:'',coverageMode:'explicit',validFrom:null,validTo:null,rootId:'A',ancestors:[],properties:seed.territorialEntities.find(row=>row.id==='A').properties}]};
 model.acceptWorld(world,1);
 let transition;const changes=[];
 const store=createTerritorialEntityStore({documentModel:model,commandOwner:{state:()=>({}),subscribeTransitions:listener=>{transition=listener;return ()=>{};},resolveWorld(){},setTimelineCursor(){}},onEntitiesReplaced:(_rows,change)=>changes.push(change)});
 const before=store.snapshot()[0].geometry;
 let offset=30,epoch=1;
 for(const operation of ['core.document-load','core.document-load-baseline','core.document-initialize','core.document-replacement-rollback']){
  const next=structuredClone(seed);
  // Every replacement has different bytes under the same archive-local ref.
  next.geometries.find(row=>row.id===binding.geometryRef.id&&row.version===binding.geometryRef.version).geojson={type:'Polygon',coordinates:[[[offset,0],[offset,10],[offset+10,10],[offset+10,0],[offset,0]]]};
  offset++;epoch++;
  model.acceptLoadedProject(next);model.acceptWorld({...world,sourceEpoch:epoch},epoch);transition({},operation);
  assert.equal(changes.at(-1).rootGeometryChanged,true,operation);
 }
 assert.notDeepEqual(store.snapshot()[0].geometry,before);store.dispose();
});

test('the shared resize owner unregisters viewport and DPR listeners before restart and disposal',()=>{
 const viewport=new globalThis.EventTarget(),query=new globalThis.EventTarget();let refreshes=0,queued=0,disconnects=0,queries=0;
 const saved=Object.fromEntries(['window','ResizeObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.assign(globalThis,{window:{visualViewport:viewport,matchMedia:()=>{queries++;return query;},devicePixelRatio:1},ResizeObserver:class{observe(){}disconnect(){disconnects++;}},requestAnimationFrame:()=>++queued,cancelAnimationFrame:()=>{}});
 try{
  const host=createMapHost({productMode:'viewer'});host.connect({platform:{$:()=>({})},workspaceUiB:{refreshMapSheetMetrics:()=>refreshes++}});
  host.initializeMapResizeObserver();host.initializeResolutionQuery();host.startMapResizeObserver();host.startMapResizeObserver();
  viewport.dispatchEvent(new globalThis.Event('resize'));assert.equal(refreshes,1,'restart must not multiply callbacks');
  query.dispatchEvent(new globalThis.Event('change'));assert.equal(queries,3,'DPR changes install the next resolution query');
  host.stopMapResizeObserver();const before=queued;
  viewport.dispatchEvent(new globalThis.Event('resize'));query.dispatchEvent(new globalThis.Event('change'));
  assert.equal(refreshes,1);assert.equal(queued,before);assert.equal(queries,3);assert.ok(disconnects>=2);
 }finally{for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
});
