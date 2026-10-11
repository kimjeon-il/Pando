#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const corpusPath = new URL('../tests/fixtures/portability/timeline-resolution.json', import.meta.url);
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));
assert.equal(corpus.schema, 'timeline-resolution-v1');
assert.equal(corpus.source, 'tests/fixtures/timeline-exchange/complex.json');
assert.ok(corpus.cases.length >= 14, 'The shared corpus must cover both eras and exact-day boundaries');

const project = JSON.parse(readFileSync(
  new URL('../tests/fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8',
));
assert.deepEqual(project.territorialEntities.map(entity => [entity.id, entity.properties.entityKind]),
  [['A', 'general'], ['B', 'general'], ['C', 'general'], ['R', 'regional']]);
assert.deepEqual(project.timelineRecords.lifetimes.map(row => [row.id, row.entityId, row.validFrom, row.validTo]), [
  ['life:A', 'A', null, null], ['life:C', 'C', null, null], ['life:R', 'R', null, null],
  ['B:ancient', 'B', '-0001', '0001'], ['B:modern', 'B', '1910-01-02', '1920-03'],
]);
const months = corpus.cases.map(({ month }) => month);
assert.equal(new Set(months).size, months.length, 'Duplicate golden timeline month');

const probe = process.argv[2];
assert.ok(probe, 'A compiled native timeline_resolution_probe executable is required');
const actual = execFileSync(probe, months, { encoding: 'utf8' }).trimEnd().split(/\r?\n/);
const expected = corpus.cases.map(({ month, expected: entities }) => [
  month, ...entities.map(([id, geometryId, version, parentId, rootId, ancestors]) =>
    [id, geometryId, version, parentId, rootId, ancestors.join('/')].join(',')),
].join('|'));
assert.deepEqual(actual, expected, 'Native month-end resolution differs from shared web golden');
console.log('14 shared month-end resolution cases match the native C++ resolver');
