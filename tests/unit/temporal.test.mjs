import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareTemporal,
  normalizeTemporalInterval,
  parseTemporal,
  temporalContains,
  temporalIntervalsOverlap,
} from '../../assets/js/modules/temporal.js';

test('calendar validation handles leap years and rejects impossible dates', () => {
  assert.equal(parseTemporal('2000-02-29').canonical, '2000-02-29');
  assert.throws(() => parseTemporal('1900-02-29'), /존재하지 않는 날짜/);
  assert.throws(() => parseTemporal('2026-02-31'), /존재하지 않는 날짜/);
  assert.throws(() => parseTemporal('2026-13-01'), /월은 01~12/);
});

test('signed BCE years order before CE years without a year zero', () => {
  assert.equal(compareTemporal('-0002', '-0001'), -1);
  assert.equal(compareTemporal('-0001', '0001'), -1);
  assert.throws(() => parseTemporal('0000'), /연도 0/);
  assert.throws(() => parseTemporal('-0000'), /연도 0/);
});

test('open intervals contain dates and interval overlap uses parsed boundaries', () => {
  const ancient = normalizeTemporalInterval(null, '-0001');
  const modern = normalizeTemporalInterval('0001', null);
  assert.equal(temporalContains(ancient, '-0500'), true);
  assert.equal(temporalContains(ancient, '0001'), false);
  assert.equal(temporalIntervalsOverlap(ancient, modern), false);
  assert.equal(temporalIntervalsOverlap(normalizeTemporalInterval('1900', '1900'), normalizeTemporalInterval('1900-12-31', null)), true);
  assert.throws(() => normalizeTemporalInterval('2020-01-01', '2019-12-31'), /시작은 종료보다 늦을 수/);
});
