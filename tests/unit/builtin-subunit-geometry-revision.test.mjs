import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuiltinSession } from '../../assets/js/modules/app-builtin-session.js';
import { builtinSubunitId, builtinSubunitSourceId } from '../../assets/js/modules/builtin-subunits.js';
import { createTerritorialFeature } from '../../assets/js/modules/territorial-units.js';
import { geometryRevision, touchGeometry } from '../../assets/js/modules/geometry-versions.js';

const square = x => ({ type: 'Polygon', coordinates: [[[x, 0], [x, 1], [x + 1, 1], [x + 1, 0], [x, 0]]] });

test('native built-in eligibility rejects in-place canonical edits even with unchanged preview coordinates', () => {
  const geometry = square(0);
  const unit = createTerritorialFeature({ id: builtinSubunitId('MAF'), entityKind: 'general', parentId: 'FRA',
    geometry, metadata: { builtinSubunit: { sourceCountryId: 'MAF' } } });
  const preview = { ...unit, geometry: square(20) };
  const display = [preview];
  const entities = [unit];
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
  assert.equal(owner.builtinTerritorialScene().collection.features[0].geometry, preview.geometry);
  touchGeometry(unit.geometry);
  unit.geometry.coordinates[0][1][0] = 0.5;
  assert.equal(geometryRevision(unit.geometry), 1);
  assert.equal(owner.isNativeBuiltinSubunit(unit), false);
  assert.equal(owner.builtinTerritorialScene().collection.features.length, 0);
  assert.equal(owner.builtinTerritorialScene({ canonical: true }).nativeUnits.size, 0);
  assert.deepEqual(preview.geometry, square(20));
});