import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep3 from "node:child_process";
import * as __dep4 from "node:readline";
import * as __dep5 from "../../../tools/gis/hydronym-normalize.mjs";

// Original feature contract: hydro-name.test.mjs
contractSuite("hydro-name", async () => {
const { test } = __dep0;
const assert = __dep1.default;
const { spawn } = __dep3;
const { createInterface } = __dep4;
const { normalizeHydronym } = __dep5;

test('normalizes suffixes, placeholders and second-pass aliases', () => {
  assert.equal(normalizeHydronym('노스아랄씨', 'lake', { '노스아랄씨': '북아랄해' }), '북아랄해');
  assert.equal(normalizeHydronym('사우스아랄씨호', 'lake', { '사우스아랄씨호': '남아랄해' }), '남아랄해');
  assert.equal(normalizeHydronym('한 강강', 'river', {}), '한강');
  assert.equal(normalizeHydronym('예시 호수', 'lake', { '예시호수': '검토 호수' }), '검토호수');
  assert.equal(normalizeHydronym('미명명   수계 4', 'river', {}), '미명명 수계 4');
  assert.equal(normalizeHydronym('  River  ', 'river', {}), 'River');
  assert.equal(normalizeHydronym('x', 'river', { x: '미명명 강\r' }), '미명명 강\r');
  assert.equal(normalizeHydronym('x', 'river', { x: '미명명 강\n' }), '미명명강\n강');
  assert.equal(normalizeHydronym('x', 'river', { x: 'X River\r' }), 'X River');
  assert.throws(() => normalizeHydronym('x', 'river', { x: 42 }), /alias must be a string/);
});

test('stream handles several requests and reports malformed input', async () => {
  const cases=[{name:'한 강강',category:'river',overrides:{},expected:'한강'},{name:'예시 호수',category:'lake',overrides:{},expected:'예시호수'}];
  const child = spawn(process.execPath, ['tools/gis/hydronym-normalize.mjs', '--stream'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rows = [];
  const lines = createInterface({ input: child.stdout });
  const reading = (async () => { for await (const line of lines) rows.push(JSON.parse(line)); })();
  child.stdin.end(`${JSON.stringify(cases[0])}\n${JSON.stringify(cases[1])}\nnot-json\n`);
  const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(await exit, 0);
  await reading;
  assert.deepEqual(rows.slice(0, 2), [{ value: cases[0].expected }, { value: cases[1].expected }]);
  assert.equal(typeof rows[2].error, 'string');
});
});

// Original feature contract: hydro-name-inventory.test.mjs
