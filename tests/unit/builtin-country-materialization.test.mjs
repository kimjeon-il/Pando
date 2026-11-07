import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {prepareLibraryData,storeLibraryData} from '../../tools/library-data.mjs';

const base='assets/data/builtin-world/generated/v1/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,{missingPart=false,badHash=false,legacy=false}={}){
 const parent=mkdtempSync(join(tmpdir(),'pando-country-runtime-')),root=join(parent,'app'),data=join(root,'.library-data/repository');
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const put=(dir,path,bytes)=>{mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);};
 const git=(dir,...args)=>execFileSync('git',['-c','core.autocrlf=false','-c','core.fsync=none',...args],{cwd:dir,encoding:'utf8',stdio:'pipe'}).trim();
 for(const dir of [root,data]){mkdirSync(dir,{recursive:true});git(dir,'init','-q');git(dir,'config','user.name','Fixture');git(dir,'config','user.email','fixture@example.invalid');}
 const files={},archive=(path,bytes,{absent=false}={})=>{
  bytes=Buffer.from(bytes);if(!absent)put(data,path,bytes);
  files[path]={stored:path,encoding:'identity',sha256:hash(bytes),bytes:bytes.length};
 };
 const decoded=Buffer.from('{"entityId":"state:test","schemaVersion":2}\n'),bytes=gzipSync(decoded);
 const country={entityId:'state:test',file:`countries/state-test-sha256-${hash(bytes)}.json.gz`,sha256:hash(bytes),encoding:'gzip',compressedBytes:bytes.length,decodedBytes:decoded.length};
 const pieces=[bytes.subarray(0,20),bytes.subarray(20)];
 country.parts=pieces.map((piece,i)=>{
  const file=`country-parts/sha256-${hash(piece)}.bin`;
  archive(base+file,piece,{absent:missingPart&&i===1});
  return {file,encoding:'identity',sha256:hash(piece),compressedBytes:piece.length,decodedBytes:piece.length};
 });
 if(badHash)files[base+country.parts[0].file].sha256='0'.repeat(64);
 const retired=[base+'transport/countries-sha256-'+hash(Buffer.from('retired'))+'.bin',base+country.file,base+'countries/orphan.json.gz'];
 for(const path of retired)archive(path,path===base+country.file?bytes:Buffer.from('retired'),{absent:!legacy});
 const index={schema:'pandolab-builtin-world',schemaVersion:2,storageLayout:'country-files-v1',inputHashes:{sourceRevisions:{}},entities:[country]};
 if(legacy){delete index.storageLayout;index.transport={url:retired[0].slice(base.length)};}
 archive(base+'index.json',JSON.stringify(index));
 // Runtime publication now verifies paired source indexes even for a
 // built-in-country-only storage scope. Model the immutable empty source
 // corpus, rather than relying on a missing archive file in this fixture.
 archive('assets/data/territorial-entities/generated/v2/index.json',JSON.stringify({entities:[]}));
 archive(base+'coverage-report.json','{}');archive('assets/data/other/value.bin','unchanged');
 put(data,'archive/index.json',JSON.stringify({schemaVersion:1,branch:'main',files}));put(data,'library.json','{}');
 git(data,'add','.');git(data,'commit','-qm','archived fixture');const pin=git(data,'rev-parse','HEAD');
 put(root,'config/library-data.json',JSON.stringify({repository:'fixture/data',revision:pin,mounts:['assets/data','reports']}));
 put(root,'.gitignore','.library-data/\nassets/data/\nreports/\n');git(root,'add','.');git(root,'commit','-qm','app');
 return {root,data,git,files,retired,pin,country};
}

test('runtime preparation needs only active builtin files and broad storage preserves unhydrated archive history',t=>{
 const f=fixture(t);
 prepareLibraryData({root:f.root,fetch:false});
 for(const part of f.country.parts)assert.ok(existsSync(join(f.root,base+part.file)));
 for(const path of f.retired)assert.equal(existsSync(join(f.root,path)),false,path);
 assert.equal(readFileSync(join(f.root,'assets/data/other/value.bin'),'utf8'),'unchanged');
 assert.equal(f.git(f.data,'rev-parse','HEAD'),f.pin);
 storeLibraryData({root:f.root,prefixes:['assets/data/builtin-world']});
 const stored=JSON.parse(f.git(f.data,'show','HEAD:archive/index.json'));
 for(const [path,entry]of Object.entries(f.files))assert.deepEqual(stored.files[path],entry,path);
});

test('missing active country part is never excused as an archived orphan',t=>{
 const f=fixture(t,{missingPart:true});
 assert.throws(()=>prepareLibraryData({root:f.root,fetch:false}),/country-parts/);
 assert.equal(f.git(f.data,'rev-parse','HEAD'),f.pin);
});

test('country catalog and archive must agree on the active file integrity pins',t=>{
 const f=fixture(t,{badHash:true});
 assert.throws(()=>prepareLibraryData({root:f.root,fetch:false}),/country.*(?:pin|integrity)|(?:pin|integrity).*country/i);
 assert.equal(f.git(f.data,'rev-parse','HEAD'),f.pin);
});

test('explicit preparation of a historical data pin remains available for one-time conversion',t=>{
 const f=fixture(t,{legacy:true});
 prepareLibraryData({root:f.root,fetch:false});
 for(const path of f.retired)assert.ok(existsSync(join(f.root,path)),path);
});
