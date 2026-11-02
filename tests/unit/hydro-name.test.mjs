import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { normalizeHydronym } from '../../tools/gis/hydronym-normalize.mjs';

const cases = JSON.parse(await readFile(new URL('../fixtures/hydro-name-oracle.json', import.meta.url), 'utf8'));

test('matches the frozen Python naming cases', () => {
  for (const row of cases) {
    assert.equal(normalizeHydronym(row.name, row.category, row.overrides), row.expected, row.name);
  }
});

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
  const child = spawn(process.execPath, ['tools/gis/hydronym-normalize.mjs', '--stream'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const rows = [];
  const lines = createInterface({ input: child.stdout });
  const reading = (async () => { for await (const line of lines) rows.push(JSON.parse(line)); })();
  child.stdin.end(`${JSON.stringify(cases[0])}\n${JSON.stringify(cases[2])}\nnot-json\n`);
  const exit = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(await exit, 0);
  await reading;
  assert.deepEqual(rows.slice(0, 2), [{ value: cases[0].expected }, { value: cases[2].expected }]);
  assert.equal(typeof rows[2].error, 'string');
});
