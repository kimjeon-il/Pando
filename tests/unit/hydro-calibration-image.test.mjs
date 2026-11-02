import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import {renderHydroCalibrationComparison} from '../../tools/gis/hydro-calibration-image.mjs';
import {decodeNativeImageBytes} from '../../tools/map-image/native-resample.mjs';

test('native hydro comparison renders a labelled PNG while preserving source inputs',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY||!process.env.PANDO_MAP_PREVIEW_ARTIFACT},async()=>{
    const regular=process.platform==='win32'?'C:/Windows/Fonts/malgun.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const bold=process.platform==='win32'?'C:/Windows/Fonts/malgunbd.ttf':'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
    if(!existsSync(regular)||!existsSync(bold))throw Error('Comparison test fonts are missing');
    const font=file=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')});
    const polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},line={type:'LineString',coordinates:[[0,0],[2,2]]};
    const input={region:{id:'korea',label:'한반도',bbox:[0,0,2,2]},riverReference:{sameLayer:true,baseFeatures:[{geometry:line}]},
      lakeReference:{sameLayer:true,baseFeatures:[{geometry:polygon}]},rivers:[{assignedStage:6,parts:[line.coordinates]}],
      lakes:[{assignedStage:7,geometry:polygon}],fonts:{regular:font(regular),bold:font(bold)}};
    const before=structuredClone(input),options={pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},preview:{directory:process.env.PANDO_MAP_PREVIEW_ARTIFACT}};
    const result=await renderHydroCalibrationComparison(input,options);
    const decoded=await decodeNativeImageBytes({bytes:result.data,format:'png',maxPixels:1000000});
    assert.deepEqual([decoded.width,decoded.height],[1744,510]);assert.deepEqual(input,before);
    const wrong=structuredClone(input);wrong.fonts.regular.sha256='0'.repeat(64);
    await assert.rejects(renderHydroCalibrationComparison(wrong,options),/font.*hash/i);
  });
