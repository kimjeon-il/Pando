import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuiltinSession } from '../../assets/js/modules/app-builtin-session.js';
import { builtinSubunitId, builtinSubunitSourceId } from '../../assets/js/modules/builtin-subunits.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { geometryRevision, touchGeometry } from '../../assets/js/modules/geometry-versions.js';
import { layerStyle } from '../../assets/js/modules/layer-presentation.js';

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
    objectCatalog: { builtinSubunitSourceId },
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
  const state = { layerVisibility: { countries: false, subunits: true }, layerPresentation: { styles: { subunits: { opacity: 0.4 } } } };
  const owner = createBuiltinSession();
  owner.connect({ projectState: { state },
    objectModelB: { territorialScope: { displayEntities: () => entities } },
    territorialModel: { entityRepository: { list: () => entities, get: id => entities.find(entity => entity.id === id) } },
    objectCatalog: { builtinSubunitSourceId }, applicationServicesB: { layerStyle },
    layerPresentation: { isLayerItemVisible: (group, id) => group === 'subunits' && id === child.id } });
  owner.installCanonicalCountryStore({ ids: () => ['CHN', 'HKG'], materializeCollectionSync: () => ({ features: [] }),
    materializeFeature: () => null, geometryEquals: () => true });
  assert.equal(owner.isNativeBuiltinSubunit(child), false);
  assert.deepEqual(owner.builtinTerritorialScene().boundaryCollection.features.map(feature => feature.id), ['CHN', 'HKG']);
  assert.equal(owner.renderCountryBoundaryStyle('HKG').opacity, 0.4);
  assert.equal(owner.renderCountryBoundaryStyle('CHN'), null);
  state.layerPresentation = { styles: { subunits: { opacity: 0.4, boundaryVisible: false } } };
  assert.equal(owner.renderCountryBoundaryStyle('HKG'), null);
});
