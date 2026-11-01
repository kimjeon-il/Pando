import assert from 'node:assert/strict';
import {drawNativePreviewLabels} from '../../tools/map-image/native-preview.mjs';

export async function assertCandidatePreview(decoded,oracle,job,name){
  // Only the candidate banner changed. Keep the frozen map and overlay pixels,
  // and compare the entire replacement banner, including its last background row.
  const bannerRows=25,start=bannerRows*decoded.width*4;
  assert.equal(decoded.data.length,oracle.length,name+' pixel count');
  assert.equal(Buffer.compare(decoded.data.subarray(start),oracle.subarray(start)),0,name+' map and overlay pixels');
  const data=Buffer.alloc(start,255);
  const banner='PROVISIONAL CANDIDATES | orange: border / blue: admin / purple: mixed / yellow: unresolved | georeference: '+
    (job.quality?.recommended?'recommended':'needs review');
  const expected=await drawNativePreviewLabels({width:decoded.width,height:bannerRows,data},[{x:5,y:5,text:banner}]);
  assert.equal(Buffer.compare(decoded.data.subarray(0,start),expected.data),0,name+' candidate banner');
}
