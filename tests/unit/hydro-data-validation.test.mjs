import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import test from 'node:test';
import {verifyHydroCompleteCatalog} from '../../tools/gis/hydro-data-validation.mjs';

test('explicit complete Hydro validation preserves count, terminal, Korea, lake and border contracts',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const ids=['40425195','40425194','40391748','40391614','40475481','40515775'],point=[128.095,42.006],bounds=[128095000,42006000,128095000,42006000];
    const features=Array.from({length:18},(_,i)=>({metadata:{fid:i+1,logicalFid:i+1,awId:`river:${i+1}`,category:'river',
      fragmentIndex:0,fragmentCount:1,role:'mainstem',name:i===0?'압록강':i===1?'두만강':'',sourceId:ids[i]||'',bounds,
      flags:i<2?1:0,source:i===0?'Natural Earth border CHN/PRK':i===1?'Natural Earth border PRK/RUS':'source',
      terminal:{class:'sea',renderEndpoint:point}},geometry:{type:'LineString',coordinates:[point,point]},widths:[[.55,.55]]}));
    features.push({metadata:{fid:19,logicalFid:19,awId:'ne:lake:1',category:'lake',bounds,flags:0,layerId:'lakes_natural_earth',
      source:'Natural Earth 5.0.0 1:10m'},geometry:{type:'Polygon',coordinates:[[[128,42],[128.1,42],[128.1,42.1],[128,42]]]},widths:[]});
    const originalLakes=Buffer.from('source'),lakeSha=createHash('sha256').update(originalLakes).digest('hex');
    const core=gzipSync(Buffer.from(JSON.stringify({version:5,features:features.map(row=>row.metadata)}))),coreSha=createHash('sha256').update(core).digest('hex');
    const manifest={version:'1',schema:'pandolab-water-shards-v5',container:{sha256:'a'.repeat(64)},cache:{name:`pandolab-water-v1-independent-${coreSha.slice(0,16)}`},
      index:{bytes:40},metadata:{featureCount:19,core:{sha256:coreSha},detail:{lazy:true}},shards:[{bytes:40}],
      stats:{featureCount:19,coordinateCount:40,compressedBytes:40,packCount:2,logicalFeatureCount:19,downstreamClosureReachCount:1,coastSnappedTerminalCount:1,
        mediumMainstemReachCount:1,borderAlignedLengthKm:1,borderAlignedReachCount:2,terminalClassCounts:{}},
      selection:{riverThresholds:[14.4744,12.4307,11.2137,10.55],riverContinuity:'closed downstream',mediumMainstemMinBasinKm2:2500,
        terminalConnectivity:{maximumCoastExtensionKm:25,unresolvedRenderedLandTerminal:'exclude unresolved'}},
      sources:{naturalEarthLakes:{sha256:lakeSha}}};
    const polygon=coordinates=>({type:'Polygon',coordinates:[coordinates]});
    const left=polygon([[128,41],[128.095,41],[128.095,43],[128,43],[128,41]]),
      right=polygon([[128.095,41],[129,41],[129,43],[128.095,43],[128.095,41]]);
    const countries=[{id:'CHN',geometry:left},{id:'PRK',geometry:right},{id:'RUS',geometry:left}];
    const input={dataset:{manifest,manifestBytes:100,packCount:2,logicalCount:19,features,core},originalLakes,countries,
      version:'1',expectedLakeCount:1,expectedLakeCoordinateCount:4};
    const options={pointScreen:{directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT},
      gzip:async values=>values.map(value=>gzipSync(value,{level:9}))};
    const result=await verifyHydroCompleteCatalog(input,options);assert.equal(result.rivers.systems,18);assert.equal(result.lakes.coordinates,4);
    assert.deepEqual(result.borders.map(row=>row.pair),['CHN/PRK','PRK/RUS']);
    const bad={...input,expectedLakeCoordinateCount:5};await assert.rejects(verifyHydroCompleteCatalog(bad,options),/coordinate count/i);
  });
