import { describe as contractSuite } from 'node:test';
import * as __country_dep0 from "../../../tools/gis/builtin-display-policy.mjs";
import * as __country_dep1 from "../../../src/document/country-feature.js";
import * as __country_dep2 from "node:test";
import * as __country_dep3 from "node:assert/strict";
import * as __country_dep5 from "../../../src/document/builtin-subunits.js";
import * as __country_dep6 from "../../../src/document/territorial-units.js";
import * as __country_dep8 from "../../../src/document/builtin-session.js";
import * as __country_dep9 from "../../../src/geometry/geometry-versions.js";
import * as __country_dep10 from "../../../src/ui/layer-presentation.js";
contractSuite("builtin-subunits", () => {
const {validateBuiltinDisplayPolicy}=__country_dep0;
const {normalizeCountryCollection}=__country_dep1;
const test=__country_dep2.default,assert=__country_dep3.default;
const {classifyBuiltinCountries,builtinSubunitId,builtinSubunitSourceId}=__country_dep5;
const square=x=>({type:'Polygon',coordinates:[[[x,0],[x,1],[x+1,1],[x+1,0],[x,0]]]});
const source=()=>({type:'FeatureCollection',features:['AAA','BBB','CCC'].map((id,i)=>({
  type:'Feature',id,properties:{name:id},geometry:square(i*3),
}))});
const policy=()=>({schema:'pandolab-builtin-display-policy',schemaVersion:1,revision:'fixture-v1',
  subunits:[{sourceCountryId:'BBB',parentId:'AAA',controllerCountryId:'CCC',lesseeCountryId:'DDD',note:'Synthetic provenance'}],
  territoryMerges:[],sourceAttributions:{}});

test('explicit parent policy classifies stable subunits without changing source geometry or identity',()=>{
  const input=source(),before=structuredClone(input),displayPolicy=policy();
  const result=classifyBuiltinCountries(normalizeCountryCollection(input),{displayPolicy});
  assert.deepEqual(result.countries.features.map(row=>row.id),['AAA','CCC']);
  assert.equal(result.subunits.length,1);
  const unit=result.subunits[0];
  assert.equal(unit.id,builtinSubunitId('BBB'));
  assert.equal(builtinSubunitSourceId(unit),'BBB');
  assert.equal(unit.properties.parentId,'AAA');
  assert.equal(unit.properties.metadata.builtinSubunit.controllerCountryId,'CCC');
  assert.equal(unit.properties.metadata.builtinSubunit.lesseeCountryId,'DDD');
  assert.deepEqual(unit.geometry,input.features[1].geometry);
  const changed=structuredClone(displayPolicy);changed.subunits[0].parentId='CCC';
  assert.equal(classifyBuiltinCountries(normalizeCountryCollection(input),{displayPolicy:changed}).subunits[0].properties.parentId,'CCC');
  assert.equal(unit.properties.parentId,'AAA');
  assert.deepEqual(input,before);
  assert.throws(()=>classifyBuiltinCountries({...input,features:input.features.slice(1)},{displayPolicy}),/원본\/부모 누락/);
});

test('display policy rejects ambiguous, duplicate and self-parent mappings',()=>{
  for(const mutate of [
    p=>p.subunits.push({...p.subunits[0]}),
    p=>{p.subunits[0].parentId='BBB';},
    p=>{p.territoryMerges=[{sourceId:'DDD',controller:'AAA'},{sourceId:'DDD',controller:'CCC'}];},
    p=>{p.territoryMerges=[{sourceId:'BBB',controller:'AAA'}];},
  ]){const value=policy();mutate(value);assert.throws(()=>validateBuiltinDisplayPolicy(value));}
  assert.doesNotThrow(()=>validateBuiltinDisplayPolicy(policy()));
});
});
contractSuite("builtin-subunit-geometry-revision", () => {
const assert = __country_dep3.default;
const test = __country_dep2.default;
const { createBuiltinSession } = __country_dep8;
const { builtinSubunitId, builtinSubunitSourceId } = __country_dep5;
const { createTerritorialFeature } = __country_dep6;
const { geometryRevision, touchGeometry } = __country_dep9;
const { layerStyle } = __country_dep10;

const square = x => ({ type: 'Polygon', coordinates: [[[x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [x, 0]]] });

test('native built-in eligibility rejects in-place canonical edits even with unchanged preview coordinates', () => {
  const geometry = square(0);
  const unit = createTerritorialFeature({ id: builtinSubunitId('MAF'), entityKind: 'general', parentId: 'FRA',
    geometry, metadata: { builtinSubunit: { sourceCountryId: 'MAF' } } });
  const preview = { ...unit, geometry: square(20) };
  const parent = createTerritorialFeature({ id: 'FRA', entityKind: 'general', geometry: square(-1) });
  const display = [parent, preview];
  const entities = [parent, unit];
  const baseline = JSON.stringify(unit.geometry);
  const owner = createBuiltinSession();
  owner.connect({ projectState: { state: { layerPresentation: {} } },
    objectModelB: { territorialScope: { displayEntities: () => display } },
    territorialModel: { entityRepository: { list: () => entities, get: id => entities.find(entity => entity.id === id) } },
    objectDefinitions: { builtinSubunitSourceId },
    applicationServicesB: { layerStyle: () => ({ opacity: 1, blendMode: 'normal', boundaryVisible: true }) } });
  owner.installCanonicalCountryStore({ ids: () => ['MAF'], materializeCollectionSync: () => ({ features: [] }),
    materializeFeature: () => null, geometryEquals: (_id, value) => JSON.stringify(value) === baseline });
  assert.equal(owner.isNativeBuiltinSubunit(unit), true);
  assert.equal(owner.builtinTerritorialScene().byId.get('MAF').geometry, preview.geometry);
  assert.equal(owner.builtinTerritorialScene().byId.get('MAF').boundaryRootId, 'FRA');
  assert.equal(owner.builtinTerritorialScene().boundaryCollection.features.find(feature => feature.id === 'MAF').boundaryPristine, true);
  touchGeometry(unit.geometry);
  unit.geometry.coordinates[0][1][0] = 0.5;
  assert.equal(geometryRevision(unit.geometry), 1);
  assert.equal(owner.isNativeBuiltinSubunit(unit), false);
  assert.equal(owner.builtinTerritorialScene().boundaryCollection.features.find(feature => feature.id === 'MAF').boundaryPristine, false);
  assert.deepEqual(owner.builtinTerritorialScene().collection.features.map(feature => feature.id), ['FRA']);
  assert.equal(owner.builtinTerritorialScene({ canonical: true }).nativeUnits.size, 0);
  assert.deepEqual(preview.geometry, square(20));
});

test('boundary projection keeps non-native children and resolves independent settings through canonical IDs', () => {
  const parent = createTerritorialFeature({ id: 'CHN', entityKind: 'general', geometry: square(0) });
  const child = createTerritorialFeature({ id: builtinSubunitId('HKG'), entityKind: 'general', parentId: 'CHN',
    geometry: square(1), metadata: { builtinSubunit: { sourceCountryId: 'HKG' } } });
  const entities = [parent, child];
  const state = { layerVisibility: { objects: true }, layerPresentation: { styles: { objects: { opacity: 0.4 } } } };
  const owner = createBuiltinSession();
  owner.connect({ projectState: { state },
    objectModelB: { territorialScope: { displayEntities: () => entities } },
    territorialModel: { entityRepository: { list: () => entities, get: id => entities.find(entity => entity.id === id) } },
    objectDefinitions: { builtinSubunitSourceId }, applicationServicesB: { layerStyle },
    layerPresentation: { isLayerItemVisible: (group, id) => group === 'objects' && id === child.id } });
  owner.installCanonicalCountryStore({ ids: () => ['CHN', 'HKG'], materializeCollectionSync: () => ({ features: [] }),
    materializeFeature: () => null, geometryEquals: () => true });
  assert.equal(owner.isNativeBuiltinSubunit(child), false);
  assert.deepEqual(owner.builtinTerritorialScene().boundaryCollection.features.map(feature => feature.id), ['CHN', 'HKG']);
  assert.equal(owner.renderCountryBoundaryStyle('HKG').opacity, 0.4);
  assert.equal(owner.renderCountryBoundaryStyle('CHN'), null);
  state.layerPresentation = { styles: { objects: { opacity: 0.4, boundaryVisible: false } } };
  assert.equal(owner.renderCountryBoundaryStyle('HKG'), null);
});
});
