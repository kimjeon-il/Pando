import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { builtinProject } from '../helpers/builtin-world.mjs';
import { deviceCurrentMonth } from '../../shared/frontend/js/modules/builtin-month-clock.js';
import { assembleBuiltinWorld, selectBuiltinCountries } from '../../shared/frontend/js/modules/builtin-world-loader.js';
import { createGeometryVersionStore } from '../../shared/frontend/js/modules/geometry-version-store.js';
import { resolveWorld } from '../../shared/frontend/js/modules/timeline-resolver.js';
import { temporalContains, temporalMonthEnd } from '../../shared/frontend/js/modules/temporal.js';

const catalogPath = new URL('../../assets/data/builtin-world/generated/v1/index.json', import.meta.url);
const catalog = () => JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const monthsToCheck = () => {
  const now = new Date();
  return [...new Set([deviceCurrentMonth(now),
    deviceCurrentMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))])];
};

test('the current and preceding months resolve from one complete historical world', () => {
  const index = catalog(), untouched = structuredClone(index);
  assert.ok(Array.isArray(index.entities) && index.entities.length > 0, 'missing country catalog');
  for (const month of monthsToCheck()) {
    const selected = selectBuiltinCountries(index, month);
    assert.ok(selected.length > 0, month + ': missing current country coverage');
    const project = builtinProject(month);
    assert.equal(project.projectSetup.initialMonth, month);
    assert.deepEqual(project.territorialEntities.map(row => row.id), index.entities.map(row => row.entityId),
      month + ': a historical identity was lost from the project');
    const ids = new Set(project.territorialEntities.map(row => row.id));
    assert.equal(ids.size, index.entities.length, month + ': duplicate country identity');
    const geometries = new Map(project.geometries.map(row => [JSON.stringify([row.id, row.version]), row]));
    for (const binding of project.timelineRecords.geometryBindings) {
      assert.ok(ids.has(binding.objectRef.id), 'binding to a country absent from this query');
      assert.ok(geometries.has(JSON.stringify([binding.geometryRef.id, binding.geometryRef.version])),
        'binding to missing loaded geometry: ' + binding.objectRef.id);
    }
    const visible = resolveWorld(project.territorialEntities, project.timelineRecords,
      createGeometryVersionStore(project.geometries), month);
    assert.ok(visible.entities.length > 0, month + ': empty physical map');
    assert.equal(new Set(visible.entities.map(row => row.id)).size, visible.entities.length);
    assert.deepEqual(visible.entities.map(row => row.id).sort(),selected.map(row => row.entityId).sort(),
      month + ': C++ selected world differs from source coverage');
    for (const row of visible.entities) {
      assert.ok(ids.has(row.id), 'unloaded country appears in the displayed scene');
      const timeline = row.identity.properties.metadata.historicalTimeline;
      assert.ok(timeline?.geometryBindings, row.id + ': missing source timeline');
      const binding = timeline.geometryBindings.find(value =>
        temporalContains(value, temporalMonthEnd(month)));
      assert.ok(binding, row.id + ': no geometry edition for selected month');
      assert.deepEqual(row.geometryRef,binding.geometryRef,
        row.id + ': resolved source geometry differs from the historic interval');
      assert.ok(row.geometry && ['Polygon', 'MultiPolygon'].includes(row.geometry.type),
        row.id + ': expected an actual displayed country geometry');
    }
  }
  assert.deepEqual(catalog(), untouched, 'date queries must never rewrite the source catalog');
});

test('a missing selected country fails instead of substituting an unrelated past snapshot', () => {
  const index = catalog(), month = monthsToCheck()[0];
  assert.ok(selectBuiltinCountries(index, month).length > 0);
  assert.throws(() => assembleBuiltinWorld(index, [], month), /Incomplete builtin country selection/);
  assert.deepEqual(catalog(), index, 'negative selection cannot mutate the index');
});
