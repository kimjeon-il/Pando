import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAP_OBJECT_CATEGORIES,
  MAP_OBJECT_TYPES,
  categoryForLayerGroup,
  layerGroupForObjectType,
  objectTypeDescriptor,
  objectTypeKeyForRef,
  objectTypeLabel,
  presentationGroupForObjectType,
} from "../../shared/frontend/js/modules/map-object-categories.js";



test('object registry exposes canonical domain/category/editor metadata', () => {
  assert.equal(MAP_OBJECT_TYPES.entity.domain, 'territorial');
  assert.equal(MAP_OBJECT_TYPES.entity.category, 'territorial');
  assert.equal(MAP_OBJECT_TYPES.entity.editor, 'entity');
  assert.equal(MAP_OBJECT_TYPES.subunit, undefined);
  assert.equal(MAP_OBJECT_TYPES.country, undefined);
  assert.equal(MAP_OBJECT_TYPES.region, undefined);
  assert.equal(MAP_OBJECT_TYPES.river.domain, 'hydro');
  assert.equal(MAP_OBJECT_TYPES.river.editor, 'hydro');
  assert.equal(MAP_OBJECT_TYPES.generic.domain, 'generic');
  assert.equal(MAP_OBJECT_TYPES.generic.creatable, false);
  assert.deepEqual(MAP_OBJECT_CATEGORIES.features.createItems, ['label', 'river', 'lake']);
});

test('object refs resolve through one registry key and presentation mapping', () => {
  assert.equal(objectTypeKeyForRef({ domain: 'territorial', type: 'entity', id: 'a' }), 'entity');
  assert.equal(objectTypeKeyForRef({ domain: 'distribution', type: 'distribution', id: 'd' }), 'distribution');
  assert.equal(objectTypeKeyForRef({ domain: 'hydro', type: 'lake', id: 'l' }), 'lake');
  assert.equal(objectTypeDescriptor({ domain: 'generic', type: 'feature' }), MAP_OBJECT_TYPES.generic);
  assert.equal(objectTypeLabel({ domain: 'territorial', type: 'entity' }), '객체');
  assert.equal(layerGroupForObjectType('distribution'), 'distributions');
  assert.equal(presentationGroupForObjectType('river'), 'rivers');
  assert.equal(categoryForLayerGroup('genericFeatures'), 'features');
});
