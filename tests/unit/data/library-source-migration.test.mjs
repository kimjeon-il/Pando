import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {assessTerritorialSourceMigration} from '../../../tools/data/territorial-source-migration.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const rows={},blobs={},files={};
 for(const id of ['AAA','BBB']){
  const entity={schemaVersion:2,entityId:'state:'+id,entityKind:'general',names:{en:id},lifetime:{validFrom:'1900-03-17',validTo:null},
   geometryVersions:[{versionId:'old',validFrom:null,validTo:null,geometry:{type:'Polygon',coordinates:[[[0,0],[1.1234567890123457,0],[1,1],[0,0]]]}}]};
  const native=Buffer.from(JSON.stringify(entity)),source=Buffer.from(JSON.stringify(entity,null,2));
  rows[entity.entityId]=hash(native);blobs['objects/'+hash(native)+'.json']=native;
  const p='assets/data/territorial-entities/source/countries/state-'+id+'.json',stored='archive/blobs/'+hash(source)+'.gz';
  files[p]={stored,encoding:'gzip',bytes:source.length,sha256:hash(source)};blobs[stored]=gzipSync(source);
 }
 const options={revision:'a'.repeat(40),archive:{schemaVersion:1,files},legacyManifest:{schemaVersion:1,entities:rows},readBlob:p=>{if(!blobs[p])throw Error('missing '+p);return blobs[p];}};
 return {options,blobs,files,rows};
}
test('migration compares normalized meaning without writing or changing dates and coordinates',()=>{
 const f=fixture(),before=Object.values(f.blobs).map(hash),r=assessTerritorialSourceMigration(f.options);
 assert.equal(r.ready,true);assert.equal(r.matched,2);assert.equal(r.conflicts,0);
 assert.deepEqual(Object.values(f.blobs).map(hash),before);assert.equal(r.rows[0].status,'matched');
 assert.deepEqual(assessTerritorialSourceMigration({...f.options,previous:r}),r,'resume is deterministic');
});
test('field and geometry conflicts are isolated; matching independent objects continue',()=>{
 const f=fixture(),id='state:AAA',key='objects/'+f.rows[id]+'.json',e=JSON.parse(f.blobs[key]);
 e.names.en='conflict';e.geometryVersions[0].geometry.coordinates[0][1][0]=2;
 const next=Buffer.from(JSON.stringify(e)),h=hash(next);f.rows[id]=h;f.blobs['objects/'+h+'.json']=next;
 const r=assessTerritorialSourceMigration(f.options);
 assert.equal(r.ready,false);assert.equal(r.conflicts,1);assert.equal(r.matched,1);
 assert.ok(r.rows[0].differences.includes('names'));assert.ok(r.rows[0].differences.includes('geometryVersions[old].geometry'));
});
for(const kind of ['native hash','missing native','missing source','invalid schema'])test('migration preserves conflicting '+kind+' rather than overwriting',()=>{
 const f=fixture(),key='objects/'+f.rows['state:AAA']+'.json';
 if(kind==='native hash')f.blobs[key]=Buffer.from('{}');
 else if(kind==='missing native'){delete f.blobs[key];f.rows['state:AAA']='f'.repeat(64);}
 else if(kind==='missing source')delete f.files['assets/data/territorial-entities/source/countries/state-AAA.json'];
 else{const e=JSON.parse(f.blobs[key]);e.schemaVersion=1;const b=Buffer.from(JSON.stringify(e)),h=hash(b);f.rows['state:AAA']=h;f.blobs['objects/'+h+'.json']=b;}
 const r=assessTerritorialSourceMigration(f.options);assert.equal(r.ready,false);assert.equal(r.conflicts,1);assert.equal(r.matched,1);
});

test('a missing old object can be proven by exact source bytes without restoring or writing it',()=>{
 const f=fixture(),id='state:AAA',old='objects/'+f.rows[id]+'.json';
 const exact=Buffer.from(JSON.stringify(JSON.parse(f.blobs[old]))+'\n');
 delete f.blobs[old];f.rows[id]=hash(exact);
 const r=assessTerritorialSourceMigration(f.options);
 assert.equal(r.ready,true);assert.equal(r.rows[0].nativeRecovery,'source-exact-content-hash');
 assert.equal(Object.hasOwn(f.blobs,'objects/'+hash(exact)+'.json'),false);
});
