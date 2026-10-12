#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const corpus = JSON.parse(readFileSync(
  new URL('../tests/fixtures/portability/timeline-edit.json', import.meta.url), 'utf8',
));
assert.equal(corpus.schema, 'timeline-edit-parity-v1');
assert.equal(corpus.cases.length, 5);

function encode(rows) {
  const nullable = value => value ?? '~';
  const result = [];
  for (const row of rows.lifetimes)
    result.push(['L', row.id, row.entityId, nullable(row.validFrom), nullable(row.validTo)].join('|'));
  for (const row of rows.geometryBindings)
    result.push(['G', row.id, row.entityId, nullable(row.validFrom), nullable(row.validTo),
      row.geometryRef.id, row.geometryRef.version].join('|'));
  for (const row of rows.parentRelations)
    result.push(['P', row.id, row.entityId, nullable(row.validFrom), nullable(row.validTo),
      row.parentId, row.coverageMode].join('|'));
  return result.join('\n') + '\n';
}
const probe = process.argv[2];
assert.ok(probe, 'A compiled native timeline_edit_probe executable is required');
const run = args => execFileSync(probe, args, { encoding: 'utf8' }).replace(/\r\n/g, '\n');
assert.equal(run(['source']), encode(corpus.records), 'Native edit input differs from shared web corpus');

for (const entry of corpus.cases) {
  const args = [entry.op, entry.month];
  if (entry.op === 'geometry') args.push(String(entry.version));
  if (entry.op === 'parent') args.push(entry.parentId, entry.coverageMode);
  assert.equal(run(args), encode(entry.expected), entry.name + ': native edit diverges from web golden');
}
console.log('5 native split/no-op/reparent/truncate cases match the shared web golden');
