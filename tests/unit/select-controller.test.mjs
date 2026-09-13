import test from 'node:test';
import assert from 'node:assert/strict';

import { filterSelectOptions, normalizeSelectQuery } from '../../assets/js/modules/select-controller.js';
import { resolveSelectChoice, selectableOptions } from '../../assets/js/modules/select-option-policy.js';

test('select search normalizes width case and whitespace', () => {
  assert.equal(normalizeSelectQuery('  ＤＥＵ  '), 'deu');
  assert.equal(normalizeSelectQuery('독일   제국'), '독일 제국');
});

test('select search ranks exact prefix and contained matches', () => {
  const options = [
    { value: 'pandolab_name', label: 'pandolab_name', searchText: '' },
    { value: 'editor_name', label: 'editor_name', searchText: '' },
    { value: 'name', label: 'name', searchText: '' },
    { value: 'name_long', label: 'name_long', searchText: '' },
    { value: 'pop_est', label: 'pop_est', searchText: '' },
  ];
  assert.deepEqual(filterSelectOptions(options, 'name').map(option => option.value), [
    'name',
    'name_long',
    'editor_name',
    'pandolab_name',
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

test('placeholder copy is excluded from the selectable and searchable option set', () => {
  const options = [
    { value: '', label: '기준 영역 선택', placeholder: true },
    { value: 'hidden', label: '숨김', hidden: true },
    { value: 'unassigned', label: '미지정 영역' },
  ];
  assert.deepEqual(selectableOptions(options).map(option => option.value), ['unassigned']);
  assert.deepEqual(filterSelectOptions(options, '').map(option => option.value), ['unassigned']);
});

test('a sole actual choice is selected and can be omitted while semantic empty choices remain actual', () => {
  assert.deepEqual(resolveSelectChoice([
    { value: '', label: '기준 영역 선택', placeholder: true },
  ], '', { autoSelectSingle: true }), {
    candidateCount: 0,
    invalid: false,
    single: false,
    value: '',
  });
  assert.deepEqual(resolveSelectChoice([
    { value: '', label: '기준 영역 선택', placeholder: true },
    { value: 'unassigned', label: '미지정 영역' },
  ], '', { autoSelectSingle: true }), {
    candidateCount: 1,
    invalid: false,
    single: true,
    value: 'unassigned',
  });
  assert.equal(resolveSelectChoice([{ value: '', label: '사용 안 함' }], '', { autoSelectSingle: true }).single, true);
  assert.equal(resolveSelectChoice([
    { value: '', label: '전체' },
    { value: 'europe', label: '유럽' },
  ], '', { autoSelectSingle: true }).candidateCount, 2);
});

test('an invalid persisted value keeps a sole replacement choice visible', () => {
  const state = resolveSelectChoice([
    { value: '', label: '소속 국가 선택', placeholder: true },
    { value: 'DEU', label: '독일' },
  ], 'missing-country', { autoSelectSingle: true, preserveInvalid: true });
  assert.equal(state.invalid, true);
  assert.equal(state.single, false);
});
