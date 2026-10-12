import assert from 'node:assert/strict';
import test from 'node:test';
import { captureWebWriterClockContract } from '../helpers/web-writer-clock-contract.mjs';

test('original service writer paths own their clocks, including empty imports and direct hydro removal', () => {
  const { rows,geometryKind }=captureWebWriterClockContract();
  assert.equal(geometryKind,'point');
  assert.deepEqual(rows.map(row => row.stateRevision),[0,1,1,2,2,2,3,4,4,5,5,6,6,7,8,9,9,9,9,10,10]);
  assert.deepEqual(rows.map(row => row.contentToken),['content:0','content:1','content:1','content:2','content:2','content:2',
    'content:3','content:4','content:4','content:5','content:5','content:6','content:6','content:7','content:8','content:9',
    'content:8','content:9','content:9','content:10','content:11']);
  assert.ok(rows.every(row => row.presentationToken==='presentation:0' && row.presentationDirty===false));
  assert.equal(rows[4].result.code,'not-found');assert.equal(rows[8].result.code,'not-found');
  assert.match(rows[5].error.message,/지원하지 않는 필드 unsupported/);
  assert.deepEqual(rows[6].result,[]);assert.deepEqual(rows[14].result,{ layers: 0,entries: 0 });
  assert.deepEqual(rows[3].genericFeatures[0].geometry,{ type: 'Point',coordinates: [1.125,2.25] });
  assert.equal(rows[3].genericFeatures[0].properties.notes,'kept');
  assert.equal(rows[11].distributionEntries[0].value,2.125);
  assert.equal(rows[13].distributionEntries[0].value,3.25);
  assert.deepEqual(rows[15].distributionLayers,[]);assert.deepEqual(rows[15].distributionEntries,[]);
  assert.deepEqual(rows[16].distributionLayers,rows[14].distributionLayers);
  assert.deepEqual(rows[16].distributionEntries,rows[14].distributionEntries);
  assert.equal(rows[18].result,false);
  assert.equal(rows[19].hydroEdits[0].properties.name,'  raw H  ');
  assert.equal(rows[20].error,null);assert.deepEqual(rows[20].hydroEdits,[]);
});
