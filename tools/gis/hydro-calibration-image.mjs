import {createHash} from 'node:crypto';
import {buildHydroCalibrationImageLayers} from './hydro-calibration-preparation.mjs';
import {renderHydroCalibrationImageLayers} from './hydro-point-screen-native.mjs';
import {drawNativePreviewLabels} from '../map-image/native-preview.mjs';
import {decodeNativeImageBytes,encodeNativePng} from '../map-image/native-resample.mjs';

// The caller supplies explicit, hash-bound fonts and owns any output file.
export async function renderHydroCalibrationComparison(input,{pointScreen={},preview={},image={},signal}={}){
  signal?.throwIfAborted();const snapshot=structuredClone(input??{}),{region,fonts}=snapshot;
  if(typeof region?.label!=='string'||!region.label||!fonts?.regular||!fonts?.bold)throw Error('Explicit Hydro image label and fonts required');
  const layers=await buildHydroCalibrationImageLayers(snapshot,{...pointScreen,signal});
  let result=await renderHydroCalibrationImageLayers(layers,{...pointScreen,signal});
  result=await drawNativePreviewLabels(result,[
    {x:16,y:12,text:`${region.label} · 최종 표시 단계 7.5`,size:18,color:0x172033},
    {x:26,y:452,text:'기본 + Natural Earth 보충',size:15,color:0x253246},
    {x:602,y:452,text:'기본 + 필터링 Hydro',size:15,color:0x253246},
    {x:1178,y:452,text:'보충 차이 강조',size:15,color:0x253246}
  ],{...preview,signal,fontFile:fonts.bold.file,fontSha256:fonts.bold.sha256});
  result=await drawNativePreviewLabels(result,[{x:18,y:482,text:'청록: Natural Earth · 자홍: Hydro · 회색: 양쪽 공통 기본 수계',size:11,color:0x59677a}],
    {...preview,signal,fontFile:fonts.regular.file,fontSha256:fonts.regular.sha256});
  const encoded=await encodeNativePng(result,{...image,signal});
  const decoded=await decodeNativeImageBytes({bytes:encoded.data,format:'png',maxPixels:1000000},{...image,signal});
  if(decoded.width!==result.width||decoded.height!==result.height||!decoded.data.equals(result.data))throw Error('Hydro comparison PNG round trip differs');
  signal?.throwIfAborted();return {width:result.width,height:result.height,data:encoded.data,sha256:createHash('sha256').update(encoded.data).digest('hex')};
}
