import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftTimelineMonth, timelineMonthLabel } from '../../assets/js/modules/timeline-controls.js';

test('timeline navigation moves by one calendar month without a year zero', () => {
  assert.equal(shiftTimelineMonth('1914-07', -1), '1914-06');
  assert.equal(shiftTimelineMonth('1914-12', 1), '1915-01');
  assert.equal(shiftTimelineMonth('0001-01', -1), '-0001-12');
  assert.equal(shiftTimelineMonth('-0001-12', 1), '0001-01');
  assert.equal(timelineMonthLabel('1914-07'), '1914년 7월');
  assert.equal(timelineMonthLabel('-0001-12'), '기원전 1년 12월');
  assert.throws(() => shiftTimelineMonth('1914-07-01', 1));
});
