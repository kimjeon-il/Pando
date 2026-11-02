import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import test from 'node:test';
import {openHydroRiverShapeReader} from '../../tools/gis/hydro-source-reader.mjs';
import {withHydroSourceSelection} from '../../tools/gis/hydro-connectivity-native.mjs';

test('selected official Rhine source reaches match frozen Python coordinates and policies',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const oracle=JSON.parse(await readFile('tests/fixtures/hydro-rhine-sample.json','utf8')),files={};
    for(const ext of ['shp','shx','dbf']){const path=resolve(`tests/fixtures/hydro-rhine-sample.${ext}`);
      files[ext]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
    const reader=await openHydroRiverShapeReader(files),options={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY};
    try{await withHydroSourceSelection({files,specification:{datasetCode:'eu'},batchSize:3},async selection=>{
      const rows=await selection.records(oracle.rows.map(row=>row.id)),shapes=await reader.read(rows.map(row=>({id:row.id,recordIndex:row.recordIndex})));
      for(let i=0;i<rows.length;i++){const expected=oracle.rows[i],row=rows[i];
        for(const key of ['id','next','mainRiver','order','flow','upstreamArea','endorheic','recordIndex','stage'])assert.equal(row[key],expected[key]);
        assert.ok(Math.abs(row.score-expected.score)<1e-12);assert.ok(Math.abs(row.width-expected.width)<1e-12);
        assert.deepEqual(shapes[i].parts,expected.parts);}
    },options);}finally{await reader.close();}
  });
