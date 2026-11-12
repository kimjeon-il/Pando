import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const script=fileURLToPath(new URL('../../../tools/gis/compose-natural-surface-masks.py',import.meta.url));
test('observed WorldCover and independent glacier/polar masks compose without changing geometry',()=>{
  assert.ok(existsSync(script),'offline observation-based natural surface composer must exist');
  const result=JSON.parse(execFileSync('python3',[script,'--self-test'],{encoding:'utf8',timeout:30000}));
  for(const gate of ['unknownPreservesBase','waterSentinelOpaque','classIsNotInterpolated',
    'glacierOverridesLandcover','polarOverridesLandcover','snowClassNotPermanentIce',
    'fractionalMaskIsBounded','invalidMaskRejected','noHeightLatitudeSnowInference',
    'sourceAndOutputSeparate'])assert.equal(result[gate],true,gate);
});
