// Shared source-independent grouping for full and affected unit selections.
// Files with incompatible native/Core prerequisites never share a Node batch.
import {requiresUnitIsolation} from './unit-test-isolation.mjs';

export const UNIT_BATCH_LIMIT = 30;

export function planUnitTestBatches(files, {requirements = new Map(), isolation = requiresUnitIsolation,
    limit = UNIT_BATCH_LIMIT} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid unit batch limit');
  const groups = new Map(), isolated = [];
  for (const file of files) {
    if (typeof file !== 'string' || !file.startsWith('tests/unit/') || !file.endsWith('.test.mjs'))
      throw Error('Invalid unit test entrypoint: ' + file);
    const required = [...new Set(requirements.get(file) || [])].sort();
    const row = {files: [file], required, isolated: Boolean(isolation(file))};
    if (row.isolated) { isolated.push(row); continue; }
    const key = JSON.stringify(required);
    if (!groups.has(key)) groups.set(key, {required, files: []});
    groups.get(key).files.push(file);
  }
  const batches = [...groups.values()].flatMap(({required, files}) => {
    const output = [];
    for (let index = 0; index < files.length; index += limit)
      output.push({files: files.slice(index, index + limit), required, isolated: false});
    return output;
  });
  return [...batches, ...isolated];
}
