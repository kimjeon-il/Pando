import {initializeTestTerritorialState,testCoreProject} from '../helpers/timeline-project.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalWorldCases } from '../fixtures/historical-world-cases.mjs';
import { createEmptyTerritorialState } from '../../assets/js/modules/territorial-entity-store.js';
import { effectiveTerritorialFlagUrl } from '../../assets/js/modules/country-flags.js';

const compiler = await import('../../tools/historical-world-timeline.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
let built;
function result() {
  assert.equal(typeof compiler.compileHistoricalWorldTimeline, 'function', 'Historical compiler must exist');
  return built ||= compiler.compileHistoricalWorldTimeline(historicalWorldCases());
}
async function view(month) {
  const state = createEmptyTerritorialState();
  await initializeTestTerritorialState(state,null,{project:result().project});
  const owner=testCoreProject(state),store=owner.entityStore;
  try {
    await store.setTimelineCursor(month);
    return state.territorialEntities;
  } finally { owner.dispose(); }
}
const visible = async (id, month) => (await view(month)).some(item => item.id === id);

test('historical timeline fixture uses a bounded synthetic current-world input instead of source assets', () => {
  const fixture = historicalWorldCases();
  assert.deepEqual(fixture.currentWorld.features.slice(0, 3).map(row => row.id), ['RUS', 'KOR', 'PRK']);
  assert.ok(fixture.currentWorld.features.length < 70);
  assert.equal(fixture.entities.length, fixture.currentWorld.features.length + 6);
  assert.ok(fixture.currentWorld.features.every(row => row.geometry.type === 'Polygon' && row.geometry.coordinates[0].length === 5));
});

test('monthEndDoesNotExtendExactSourceDates', async () => {
  assert.equal(await visible('state:test-ukraine', '2014-02'), true);
  assert.equal(await visible('state:test-ukraine', '2014-03'), false);
  assert.equal(await visible('state:single-day', '1989-04'), false);
  const records = result().project.timelineRecords;
  const day = records.lifetimes.find(row => row.entityId === 'state:single-day');
  assert.equal(day.validFrom, '1989-04-25'); assert.equal(day.validTo, '1989-04-25');
});
test('modernGeometryIsLimitedToSourceMonth', async () => {
  assert.equal(await visible('RUS', '2026-09'), false);
  assert.equal(await visible('RUS', '2026-10'), true);
  assert.equal(await visible('RUS', '2026-11'), false);
});
test('parentCoverageLimitsChildPresence', async () => {
  assert.equal(await visible('state:child', '1900-12'), true);
  assert.equal(await visible('state:child', '1901-07'), false);
  assert.equal(await visible('state:child', '1902-01'), true);
});
test('lineageDoesNotCollapseSimultaneousEntities', async () => {
  assert.equal(await visible('KOR', '2026-10'), true);
  assert.equal(await visible('PRK', '2026-10'), true);
  assert.equal(await visible('state:parent', '1900-12'), true);
  assert.equal(await visible('state:child', '1900-12'), true);
});
test('stableIdentitySurvivesGeometryVersionChange', async () => {
  const before = (await view('2020-10')).find(item => item.id === 'state:changing');
  const after = (await view('2020-11')).find(item => item.id === 'state:changing');
  assert.equal(before.id, after.id); assert.notDeepEqual(before.geometry, after.geometry);
});
test('leapDayIsVisibleAtFebruaryMonthEnd', async () => assert.equal(await visible('state:leap', '2000-02'), true));
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
test('historical defaults reach root flags and color without promoting a child flag', () => {
  const input = historicalWorldCases();
  const flag = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8"><path fill="#f00" d="M0 0h16v8H0z"/></svg>').toString('base64');
  for (const id of ['state:test-ukraine', 'state:child']) {
    const entity = input.entities.find(row => row.entityId === id);
    Object.assign(entity.metadata, { defaultColor: '#53657A', defaultFlagDataUrl: flag });
  }
  const project = compiler.compileHistoricalWorldTimeline(input).project;
  const root = project.territorialEntities.find(row => row.id === 'state:test-ukraine');
  assert.equal(root.properties.style.color?.toUpperCase(), '#53657A');
  assert.equal(effectiveTerritorialFlagUrl(root), flag);
  const child = project.territorialEntities.find(row => row.id === 'state:child');
  assert.equal(child.properties.style.color?.toUpperCase(), '#53657A');
  assert.equal(child.properties.metadata.defaultFlagDataUrl, flag);
  assert.equal(Object.hasOwn(child.properties.metadata, 'flagDataUrl'), false);
});
