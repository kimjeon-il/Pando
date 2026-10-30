import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTerrainPreviewArgs} from '../../tools/build-terrain-preview.mjs';

test('terrain preview CLI selects one explicit action and rejects invalid arguments',()=>{
  assert.equal(parseTerrainPreviewArgs(['--check']).mode,'check');
  assert.equal(parseTerrainPreviewArgs(['--rebuild-check','--output','somewhere']).mode,'rebuild-check');
  assert.equal(parseTerrainPreviewArgs([]).mode,'build');
  assert.throws(()=>parseTerrainPreviewArgs(['--check','--rebuild-check']),/mode/i);
  assert.throws(()=>parseTerrainPreviewArgs(['--output']),/value/i);
  assert.throws(()=>parseTerrainPreviewArgs(['--unknown']),/argument/i);
});
