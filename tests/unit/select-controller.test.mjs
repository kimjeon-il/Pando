import test from 'node:test';
import assert from 'node:assert/strict';

import { filterSelectOptions, normalizeSelectQuery } from '../../assets/js/modules/select-controller.js';

test('select search normalizes width case and whitespace', () => {
  assert.equal(normalizeSelectQuery('  ＤＥＵ  '), 'deu');
  assert.equal(normalizeSelectQuery('독일   제국'), '독일 제국');
});

test('select search ranks exact prefix and contained matches', () => {
  const options = [
    { value: 'aw_name', label: 'aw_name', searchText: '' },
    { value: 'editor_name', label: 'editor_name', searchText: '' },
    { value: 'name', label: 'name', searchText: '' },
    { value: 'name_long', label: 'name_long', searchText: '' },
    { value: 'pop_est', label: 'pop_est', searchText: '' },
  ];
  assert.deepEqual(filterSelectOptions(options, 'name').map(option => option.value), [
    'name',
    'name_long',
    'aw_name',
    'editor_name',
  ]);
});

test('select search includes technical values and aliases', () => {
  const options = [
    { value: 'DEU', label: '독일', searchText: 'Germany Federal Republic' },
    { value: 'DNK', label: '덴마크', searchText: 'Denmark' },
  ];
  assert.equal(filterSelectOptions(options, 'deu')[0]?.label, '독일');
  assert.equal(filterSelectOptions(options, 'germany')[0]?.value, 'DEU');
  assert.equal(filterSelectOptions(options, '독')[0]?.value, 'DEU');
});
