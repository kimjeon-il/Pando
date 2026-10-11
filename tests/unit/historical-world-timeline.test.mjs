import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalWorldCases } from '../fixtures/historical-world-cases.mjs';
import { createEmptyTerritorialState, createTerritorialEntityStore } from '../../assets/js/modules/territorial-entity-store.js';

const compiler = await import('../../tools/historical-world-timeline.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
let built;
function result() {
  assert.equal(typeof compiler.compileHistoricalWorldTimeline, 'function', 'Historical compiler must exist');
  return built ||= compiler.compileHistoricalWorldTimeline(historicalWorldCases());
}
function view(month) {
  const state = createEmptyTerritorialState();
  const store = createTerritorialEntityStore({ getState: () => state });
  store.restoreProject(result().project);
  store.setTimelineCursor(month);
  return state.territorialEntities;
}
const visible = (id, month) => view(month).some(item => item.id === id);

test('monthEndDoesNotExtendExactSourceDates', () => {
  assert.equal(visible('state:test-ukraine', '2014-02'), true);
  assert.equal(visible('state:test-ukraine', '2014-03'), false);
  assert.equal(visible('state:single-day', '1989-04'), false);
  const records = result().project.timelineRecords;
  const day = records.lifetimes.find(row => row.entityId === 'state:single-day');
  assert.equal(day.validFrom, '1989-04-25'); assert.equal(day.validTo, '1989-04-25');
});
test('modernGeometryIsLimitedToSourceMonth', () => {
  assert.equal(visible('RUS', '2026-09'), false);
  assert.equal(visible('RUS', '2026-10'), true);
  assert.equal(visible('RUS', '2026-11'), false);
});
test('parentCoverageLimitsChildPresence', () => {
  assert.equal(visible('state:child', '1900-12'), true);
  assert.equal(visible('state:child', '1901-07'), false);
  assert.equal(visible('state:child', '1902-01'), true);
});
test('lineageDoesNotCollapseSimultaneousEntities', () => {
  assert.equal(visible('KOR', '2026-10'), true);
  assert.equal(visible('PRK', '2026-10'), true);
  assert.equal(visible('state:parent', '1900-12'), true);
  assert.equal(visible('state:child', '1900-12'), true);
});
test('stableIdentitySurvivesGeometryVersionChange', () => {
  const before = view('2020-10').find(item => item.id === 'state:changing');
  const after = view('2020-11').find(item => item.id === 'state:changing');
  assert.equal(before.id, after.id); assert.notDeepEqual(before.geometry, after.geometry);
});
test('leapDayIsVisibleAtFebruaryMonthEnd', () => assert.equal(visible('state:leap', '2000-02'), true));
test('compilationPreservesRawSourceDatesAndCoordinates', () => {
  const input = historicalWorldCases(), before = structuredClone(input);
  compiler.compileHistoricalWorldTimeline(input);
  assert.deepEqual(input, before);
  const item = result().project.territorialEntities.find(row => row.id === 'state:test-ukraine');
  assert.equal(item.properties.metadata.historicalTimeline.lifetime.validTo, '2014-03-17');
});
test('compilerRejectsReversedIntervalsAndMissingGeometry', () => {
  const reversed = historicalWorldCases(); reversed.entities.at(-1).lifetime.validFrom = '2001';
  assert.throws(() => compiler.compileHistoricalWorldTimeline(reversed), /기간|interval/i);
  const missing = historicalWorldCases(); delete missing.entities.at(-1).geometryVersions[0].geometry;
  assert.throws(() => compiler.compileHistoricalWorldTimeline(missing), /geometry|형상/i);
});
