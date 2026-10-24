import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {applyLsibSupplement} from '../../tools/apply-lsib-supplement.mjs';

test('LSIB updates the open display version, independently of an undated historic representative',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lsib-display-period-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'countries'));fs.mkdirSync(path.join(root,'views'));
 const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
 const entity={schemaVersion:2,entityId:'state:TST',entityKind:'general',names:{ko:'Test'},sourceInfo:{title:'Test'},
  lifetime:{validFrom:'1900',validTo:null},metadata:{representativeGeometryVersionId:'closed'},
  geometryVersions:[{versionId:'closed',validFrom:'1900',validTo:'1950',geometry},
   {versionId:'open',validFrom:'1951',validTo:null,geometry}]};
 const bytes=JSON.stringify(entity);fs.writeFileSync(path.join(root,'countries/state-TST.json'),bytes);
 const view={schemaVersion:1,selections:[{entityId:entity.entityId,geometryVersionId:'open'}]};
 const viewPath=path.join(root,'views/world.json');fs.writeFileSync(viewPath,JSON.stringify(view));
 const change={entityId:entity.entityId,geometryVersionId:'open',geometry,sourceId:'ne+dos-lsib-11.4',
  inputFileSha256:createHash('sha256').update(bytes).digest('hex'),sourceAttributions:[],supplement:{coastline:'preserved'}};
 const candidate={schemaVersion:1,sourceId:'dos-lsib-11.4',changes:[change]};
 assert.deepEqual(applyLsibSupplement(candidate,{root,check:true}),{countries:1,applied:false});
 change.geometryVersionId='closed';
 assert.throws(()=>applyLsibSupplement(candidate,{root,check:true}),/Historical/);
 view.selections[0].geometryVersionId='closed';fs.writeFileSync(viewPath,JSON.stringify(view));
 assert.throws(()=>applyLsibSupplement(candidate,{root,check:true}),/Historical/);
 assert.equal(fs.readFileSync(path.join(root,'countries/state-TST.json'),'utf8'),bytes);
});

// Closed historical geometry must fail before source-chain processing.
test('Korean refinement rejects a closed explicitly selected version',async()=>{
 const {refineChinesePaektuSource}=await import('../../tools/build-korean-boundaries.mjs');
 const entity={geometryVersions:[{versionId:'closed',validTo:'1950'}]};
 const before=structuredClone(entity);
 assert.throws(()=>refineChinesePaektuSource(entity,{features:[]},'test','closed'),/Missing open Chinese display geometry/);
 assert.deepEqual(entity,before);
});
