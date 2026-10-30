import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {raster} from '../../plugins/pando-map-tools/lib/raster.mjs';
import {readNativeImage} from '../../tools/map-image/native-resample.mjs';

test('native review previews preserve map pixels, overlays and labels without Python',async t=>{
  process.env.PANDO_MAP_PYTHON=resolve('definitely-missing-python');
  const root=resolve('tests/fixtures/map-image/preview'),temporary=mkdtempSync(join(tmpdir(),'pando-map-preview-'));
  t.after(()=>rmSync(temporary,{recursive:true,force:true}));
  for(const name of ['rich','wide']){
    const path=resolve(root,name+'.png'),before=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,name+'.json'),'utf8'));
    const actual=await raster({action:'preview',path,job:oracle.job});
    assert.deepEqual({width:actual.width,height:actual.height},oracle.expected,name+' dimensions');
    const output=join(temporary,name+'.png');writeFileSync(output,actual.data);
    const decoded=await readNativeImage({path:output,format:'png',maxPixels:16777216});
    assert.deepEqual(decoded.data,readFileSync(resolve(root,name+'.rgba')),name+' pixels');
    assert.deepEqual(readFileSync(path),before,name+' original');
  }
});
