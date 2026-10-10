import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareTemporal,
  normalizeTemporal,
  normalizeTemporalInterval,
  parseTemporal,
  temporalContains,
  temporalIntervalsOverlap,
  temporalMonthEnd,
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


test('month precision retains its text and has no invented day', () => {
  const value = parseTemporal(' \u00a01914-07\u00a0 ');
  assert.equal(value.source, '1914-07');
  assert.equal(value.canonical, '1914-07');
  assert.equal(value.precision, 'month');
  assert.equal(value.year, 1914);
  assert.equal(value.month, 7);
  assert.equal(value.day, null);
  assert.deepEqual(value.startKey, [1914, 7, 1]);
  assert.deepEqual(value.endKey, [1914, 7, 31]);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.startKey));
  assert.ok(Object.isFrozen(value.endKey));
  assert.equal(normalizeTemporal(' 1914-07 '), '1914-07');
});

test('every month ends on its actual last day', () => {
  const lastDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let month = 1; month <= 12; month += 1) {
    const value = parseTemporal(`1914-${String(month).padStart(2, '0')}`);
    assert.deepEqual(value.startKey, [1914, month, 1]);
    assert.deepEqual(value.endKey, [1914, month, lastDays[month - 1]]);
  }
});

test('February month boundaries use the existing signed-year leap rule', () => {
  for (const [input, year, lastDay] of [
    ['1915-02', 1915, 28], ['1916-02', 1916, 29],
    ['1900-02', 1900, 28], ['2000-02', 2000, 29], ['2100-02', 2100, 28],
    ['-0400-02', -400, 29], ['-0100-02', -100, 28], ['-0001-02', -1, 28],
    ['+12000-02', 12000, 29],
  ]) {
    assert.deepEqual(parseTemporal(input).endKey, [year, 2, lastDay], input);
  }
});

test('month precision preserves signed and extended years without a year zero', () => {
  for (const input of ['-0001-12', '0001-01', '+1914-07', '+12000-01', '+999999-12', '-999999-01']) {
    assert.equal(parseTemporal(input).canonical, input);
  }
  assert.equal(compareTemporal('-0002-12', '-0001-01'), -1);
  assert.equal(compareTemporal('-0001-12', '0001-01', { leftBoundary: 'end' }), -1);
});

test('malformed month values still fail date validation', () => {
  for (const input of [
    '1914-00', '1914-13', '1914-7', '1914-', '1914-07-', '1914-07-1',
    '1914-07-00', '1914-04-31', '1915-02-29', '1914-07-15T00:00:00Z',
    '0000-07', '-0000-07', '+0000-07', '12000-07', '+1000000-01', '--0001-07',
  ]) {
    assert.throws(() => parseTemporal(input), { code: 'PL-TEMPORAL-001' }, input);
  }
});

test('year and date precision are unchanged after adding months', () => {
  const year = parseTemporal('1914');
  assert.equal(year.precision, 'year');
  assert.equal(year.month, null);
  assert.equal(year.day, null);
  assert.deepEqual(year.startKey, [1914, 1, 1]);
  assert.deepEqual(year.endKey, [1914, 12, 31]);
  const day = parseTemporal('1916-02-29');
  assert.equal(day.precision, 'date');
  assert.equal(day.month, 2);
  assert.equal(day.day, 29);
  assert.deepEqual(day.startKey, [1916, 2, 29]);
  assert.deepEqual(day.endKey, day.startKey);
  assert.equal(parseTemporal(null), null);
  assert.equal(normalizeTemporal(' '), null);
  assert.throws(() => parseTemporal('', { nullable: false }), /값이 필요합니다/);
});

test('mixed precision comparisons honor the selected boundary', () => {
  assert.equal(compareTemporal('1914-07', '1914-07-01'), 0);
  assert.equal(compareTemporal('1914-07', '1914-07-31', { leftBoundary: 'end' }), 0);
  assert.equal(compareTemporal('1914', '1914-01'), 0);
  assert.equal(compareTemporal('1914', '1914-12', { leftBoundary: 'end', rightBoundary: 'end' }), 0);
  assert.equal(compareTemporal('1914-07', '1914-08', { leftBoundary: 'end' }), -1);
});

test('a same-month interval includes both endpoints but not adjacent dates', () => {
  const july = normalizeTemporalInterval('1914-07', '1914-07');
  assert.equal(july.validFrom, '1914-07');
  assert.equal(july.validTo, '1914-07');
  for (const [date, expected] of [
    ['1914-06-30', false], ['1914-07-01', true], ['1914-07-15', true],
    ['1914-07-31', true], ['1914-08-01', false],
  ]) assert.equal(temporalContains(july, date), expected, date);
  assert.equal(temporalContains({ validFrom: '1914-07', validTo: '1914-07' }, '1914-07-31'), true);
});

test('open monthly intervals and BCE to CE boundaries remain inclusive', () => {
  const before = normalizeTemporalInterval(null, '1914-06');
  const after = normalizeTemporalInterval('1914-07', null);
  assert.equal(temporalContains(before, '1914-06-30'), true);
  assert.equal(temporalContains(before, '1914-07-01'), false);
  assert.equal(temporalContains(after, '1914-07-01'), true);
  assert.equal(temporalIntervalsOverlap(before, after), false);
  assert.equal(temporalIntervalsOverlap(
    normalizeTemporalInterval(null, '-0001-12'), normalizeTemporalInterval('0001-01', null),
  ), false);
  assert.equal(temporalContains(normalizeTemporalInterval(null, null), '+999999-12'), true);
});

test('monthly overlaps use endpoints rather than text order or array order', () => {
  const july = normalizeTemporalInterval('1914-07', '1914-07');
  const lastDay = normalizeTemporalInterval('1914-07-31', '1914-07-31');
  const august = normalizeTemporalInterval('1914-08', '1914-08');
  assert.equal(temporalIntervalsOverlap(july, lastDay), true);
  assert.equal(temporalIntervalsOverlap(lastDay, july), true);
  assert.equal(temporalIntervalsOverlap(july, august), false);
  assert.equal(temporalIntervalsOverlap(august, july), false);
  assert.equal(temporalIntervalsOverlap(july, normalizeTemporalInterval('1914', '1914')), true);
});

test('reversed monthly and mixed precision intervals are rejected', () => {
  for (const [from, to] of [
    ['1914-08', '1914-07'], ['1914-08-01', '1914-07'],
    ['1914-07', '1914-06-30'], ['0001-01', '-0001-12'],
  ]) assert.throws(() => normalizeTemporalInterval(from, to), { code: 'PL-TEMPORAL-INTERVAL' });
  assert.doesNotThrow(() => normalizeTemporalInterval('1914-07-31', '1914-07'));
  assert.doesNotThrow(() => normalizeTemporalInterval('1914-07', '1914-07-01'));
});

test('timeline month-end reference is an exact date without changing source precision', () => {
  assert.equal(temporalMonthEnd('1953-07').canonical, '1953-07-31');
  assert.equal(temporalMonthEnd('2000-02').canonical, '2000-02-29');
  assert.equal(temporalMonthEnd('-0001-02').canonical, '-0001-02-28');
  assert.equal(temporalMonthEnd('1953-07').precision, 'date');
  assert.throws(() => temporalMonthEnd('1953'), { code: 'PL-TEMPORAL-001' });
  assert.throws(() => temporalMonthEnd('1953-07-27'), { code: 'PL-TEMPORAL-001' });
});

test('a month interval is not silently treated as a month-end snapshot', () => {
  const endedMidMonth = normalizeTemporalInterval(null, '1914-07-15');
  // Existing interval queries retain overlap semantics. T3 must resolve the
  // timeline cursor to a single month-end date before querying visibility.
  assert.equal(temporalContains(endedMidMonth, '1914-07'), true);
  assert.equal(temporalContains(endedMidMonth, '1914-07-31'), false);
  assert.equal(temporalContains(normalizeTemporalInterval('1914-07-15', null), '1914-07-31'), true);
});
