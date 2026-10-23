import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../helpers/spherical-core.mjs';
import '../../assets/js/vendor/polygon-clipping.min.js';
import {calculateLibraryBatch} from '../../assets/js/modules/map-edit-library-calculation.js';
import {createTerritorialFeature} from '../../assets/js/modules/territorial-units.js';
import '../../assets/js/workers/gpu-mesh-core.js';
import {encodePolygonMesh,decodePolygonMesh} from '../../assets/js/modules/polygon-mesh-codec.js';

test('DDR adopted shared-border import audits Boolean roundoff without taking Polish or Czech territory',async()=>{
  const source=JSON.parse(fs.readFileSync(new URL('../../assets/data/territorial-entities/source/countries/state-deutsche-demokratische-republik.json',import.meta.url)));
  const current=JSON.parse(fs.readFileSync(new URL('../../assets/data/territorial-entities/generated/current-world.geojson',import.meta.url))).features.filter(f=>['DEU','CZE','POL'].includes(f.id));
  const geometry=source.geometryVersions[0].geometry;
  const feature=createTerritorialFeature({id:'DDR-regression',name:'동독',entityKind:'general',geometry});
  const original=JSON.stringify({source,current,feature});
  const result=await calculateLibraryBatch({countries:[feature],units:[]},current,[],globalThis.polygonClipping,async()=>{});
  assert.deepEqual(result.donorIds,['DEU']);
  assert.deepEqual(result.features.find(f=>f.id===feature.id).geometry,geometry);
  assert.equal(result.precisionDiscards.length,4);
  assert.ok(result.precisionDiscards.every(row=>row.areaM2>=0&&row.areaM2<0.1&&Number.isInteger(row.operationIndex)));
  // The donor gains the new detailed inland edge too. Two distinct packed
  // vertices can collapse to one Float32 display coordinate after subtraction.
  for(const changed of result.features){
    const packet=globalThis.PandoLabGpuMeshCore.buildPolygonGeometryPacket(changed.geometry);
    const decoded=decodePolygonMesh(encodePolygonMesh(packet),{
      algorithmVersion:globalThis.PandoLabGpuMeshCore.MESH_ALGORITHM_REVISION,
    });
    assert.deepEqual(decoded.ringCoordinates,packet.ringCoordinates);
    const polygons=changed.geometry.type==='Polygon'?[changed.geometry.coordinates]:changed.geometry.coordinates;
    assert.deepEqual([...decoded.ringCoordinates],polygons.flat(3));
    assert.deepEqual(decoded.startsEnds,packet.startsEnds);
  }
  assert.equal(JSON.stringify({source,current,feature}),original,'source and donor snapshots stay immutable');
});
