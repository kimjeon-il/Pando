import { describe as contractSuite } from 'node:test';
import * as __country_dep0 from "../../tools/gis/builtin-display-policy.mjs";
import * as __country_dep1 from "../../src/document/country-feature.js";
import * as __country_dep2 from "node:test";
import * as __country_dep3 from "node:assert/strict";
import * as __country_dep4 from "node:fs";
import * as __country_dep5 from "../../src/document/builtin-subunits.js";
import * as __country_dep6 from "../../src/document/territorial-units.js";
import * as __country_dep7 from "../../src/document/builtin-territory-policy.js";
import * as __country_dep8 from "../../src/document/builtin-session.js";
import * as __country_dep9 from "../../src/geometry/geometry-versions.js";
import * as __country_dep10 from "../../src/ui/layer-presentation.js";
contractSuite("builtin-subunits", () => {
const { loadBuiltinDisplayPolicy, validateBuiltinDisplayPolicy } = __country_dep0;
const { normalizeCountryCollection } = __country_dep1;
const test = __country_dep2.default;
const assert = __country_dep3.default;
const { readFileSync } = __country_dep4;
const { classifyBuiltinCountries, builtinSubunitSourceId } = __country_dep5;
const { normalizeTerritorialEntities } = __country_dep6;
const { mergeBuiltinTerritories } = __country_dep7;









const displayPolicy=loadBuiltinDisplayPolicy();
const source = JSON.parse(readFileSync(new URL('../../assets/data/countries-ne-5.1.1.geojson', import.meta.url)));
const before = JSON.stringify(source);
const result = classifyBuiltinCountries(normalizeCountryCollection(source),{displayPolicy});
const ids = new Set(result.countries.features.map(f => f.id));

test('47 agreed source objects become stable Subunits; 207 countries and exceptions remain', () => {
  assert.equal(displayPolicy.subunits.length, 47);
  assert.equal(new Set(result.subunits.map(f => f.id)).size, 47);
  assert.equal(ids.size, 207);
  for (const id of ['ATA', 'BRT', 'SAH', 'CNM', 'CYN', 'SOL', 'KAS', 'SPI']) assert.ok(ids.has(id));
  for (const unit of result.subunits) {
    assert.match(unit.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(ids.has(unit.properties.parentId));
    assert.equal('sovereignId' in unit.properties, false);
  }
});

test('all source geometries stay identical; normalization and classification do not mutate input', () => {
  const originals = new Map(source.features.map(f => [f.id, f]));
  const normalized = normalizeTerritorialEntities([...result.countries.features, ...result.subunits]).filter(feature => feature.properties.parentId);
  assert.equal(normalized.length, 47);
  for (const feature of [...result.countries.features, ...normalized]) {
    const original = originals.get(builtinSubunitSourceId(feature) || feature.id);
    const expected = mergeBuiltinTerritories(source,displayPolicy.territoryMerges).features.find(f => f.id === original.id);
    assert.deepEqual(feature.geometry, expected?.geometry || original.geometry);
    assert.equal(feature.properties.name, original.properties.name);
  }
  assert.equal(JSON.stringify(source), before);
  assert.deepEqual(classifyBuiltinCountries(normalizeCountryCollection(source),{displayPolicy}), result);
});

test('changing declarative parent data changes only generated project metadata',()=>{
  const altered=structuredClone(displayPolicy);
  altered.subunits.find(row=>row.sourceCountryId==='JEY').parentId='FRA';
  const derived=classifyBuiltinCountries(normalizeCountryCollection(source),{displayPolicy:altered});
  const find=sourceId=>derived.subunits.find(feature=>builtinSubunitSourceId(feature)===sourceId);
  assert.equal(find('JEY').properties.parentId,'FRA');
  assert.equal(result.subunits.find(feature=>builtinSubunitSourceId(feature)==='JEY').properties.parentId,'GBR');
  assert.equal(JSON.stringify(source),before,'source geography is never edited by policy experiments');
});

test('Guantanamo and Baikonur separate parent from controller or lessee', () => {
  const unit = id => result.subunits.find(f => builtinSubunitSourceId(f) === id);
  assert.equal(unit('USG').properties.parentId, 'CUB');
  assert.equal(unit('USG').properties.metadata.builtinSubunit.controllerCountryId, 'USA');
  assert.equal(unit('KAB').properties.parentId, 'KAZ');
  assert.equal(unit('KAB').properties.metadata.builtinSubunit.lesseeCountryId, 'RUS');
  assert.match(unit('KAB').properties.notes, /OpenStreetMap.*(?:\n|.)*ODbL/u);
  assert.match(result.countries.features.find(feature => feature.id === 'KAZ').properties.notes, /OpenStreetMap.*(?:\n|.)*ODbL/u);
  assert.throws(() => classifyBuiltinCountries({ ...source, features: source.features.filter(f => f.id !== 'CUB') },{displayPolicy}), /원본\/부모 누락/);
});




test('declarative display policy rejects duplicate source IDs and invalid parent mappings',()=>{
 const duplicate=structuredClone(displayPolicy);
 duplicate.subunits.push({...duplicate.subunits[0]});
 assert.throws(()=>validateBuiltinDisplayPolicy(duplicate),/duplicate/);
 const self=structuredClone(displayPolicy);
 self.subunits[0].parentId=self.subunits[0].sourceCountryId;
 assert.throws(()=>validateBuiltinDisplayPolicy(self),/relation/);
 const merge=structuredClone(displayPolicy);
 merge.territoryMerges.push({...merge.territoryMerges[0]});
 assert.throws(()=>validateBuiltinDisplayPolicy(merge),/duplicate/);
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
