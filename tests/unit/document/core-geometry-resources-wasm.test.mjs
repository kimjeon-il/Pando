import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createNodeCoreDocument} from '../../helpers/core-session.mjs';
import {startupDocument} from '../../helpers/core-startup.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

test('Core retains all eras, admits verified missing geometry without edits, and saves offline',async t=>{
 const source=JSON.parse(readFileSync(new URL('../../fixtures/timeline-exchange/complex.json',import.meta.url)));
 source.territorialEntities=source.territorialEntities.slice(0,1);
 for(const key of ['labels','hydroEdits','genericFeatures','distributionLayers','distributionEntries'])source[key]=[];
 source.distributionSettings={renderMode:'single',activeLayerId:'',boundaryVisible:false};
 source.projectSetup={initialMonth:'2000-01',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
 const owner={domain:'territorial',id:source.territorialEntities[0].id};
 const shapes=[0,2,4].map(x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]}));
 const payloads=shapes.map((shape,i)=>({id:'lazy-shape',version:i+1,source:JSON.stringify(shape)+'\n'}));
 source.geometryResources=payloads.map(row=>({id:row.id,version:row.version,type:'Polygon',contentSha256:hash(row.source),decodedBytes:Buffer.byteLength(row.source)}));
 source.geometries=[payloads[0]];
 source.timelineRecords={schemaVersion:3,lifetimes:[{id:'life',objectRef:owner,validFrom:null,validTo:null}],
  geometryBindings:payloads.map((row,i)=>({id:'binding-'+i,objectRef:owner,validFrom:[null,'2010','2020'][i],validTo:['2009','2019',null][i],geometryRef:{id:row.id,version:row.version}})),
  parentRelations:[{id:'parent',objectRef:owner,validFrom:null,validTo:null,parentId:'',coverageMode:'explicit'}],propertyBindings:[]};
 const client=createNodeCoreDocument();t.after(()=>client.dispose());
 await client.load(JSON.stringify(startupDocument([])));
 const bytes=Buffer.from(JSON.stringify(source));
 const admitted=await client.storageBaselineLoad({kind:'stored-asset',encoding:'identity',sourceBytes:new Uint8Array(bytes),compressedBytes:bytes.length,decodedBytes:bytes.length,
  sourceMonth:'2000-01',baseDataset:source.baseDataset,fingerprint:hash(bytes)});
 await client.loadBaseline(admitted.state.storageBaselineId,source.projectSetup);
 const before=client.state(),needed=await client.geometryRequirements('2015-01');
 assert.deepEqual(needed.resources.map(row=>row.version),[2]);
 await assert.rejects(client.resolveWorld('2015-01'),error=>error.code==='GEOMETRY_UNLOADED'&&error.missingGeometryRefs[0].version===2);
 await assert.rejects(client.admitGeometryResources([{...payloads[1],source:payloads[1].source+' '}]),/integrity/);
 assert.deepEqual(client.state(),before);
 await client.admitGeometryResources([payloads[1]]);
 assert.deepEqual(client.state(),before,'payload readiness must not change dirty state, epochs, revisions or history');
 assert.equal((await client.resolveWorld('2015-01')).entities[0].geometryRef.version,2);
 const loaded=[];client.setGeometryLoader(async requirements=>{loaded.push(...requirements.map(row=>row.version));return requirements.map(row=>payloads[row.version-1]);});
 await client.setTimelineCursor('2015-01');
 assert.equal(client.state().documentDirty,false);
 const output=await client.exportSnapshot({version:'fixture',savedAt:'2026-11-08T00:00:00.000Z',format:'pandolab-project-state'});
 assert.deepEqual(loaded,[3],'saving must include the future shape, not only the selected era');
 const saved=JSON.parse(output.storageJson);
 assert.equal(Object.hasOwn(saved,'geometryResources'),false);
 assert.deepEqual(saved.geometries.map(row=>row.geojson),shapes);
 assert.deepEqual(saved.timelineRecords,source.timelineRecords);
 client.setGeometryLoader(async()=>{throw Error('offline');});
 await client.load(output.storageJson);await client.setTimelineCursor('2025-01');
 assert.equal((await client.resolveWorld('2025-01')).entities[0].geometryRef.version,3);
});
