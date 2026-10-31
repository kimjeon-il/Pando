import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import {readZipRangeMember,zipMembers,zipRangeMembers} from '../../tools/lib/geonames-zip.mjs';
import {readLSIBArchiveEvidence} from '../../tools/gis/lsib-source-native.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
async function zip(entries){
  const archive=new yazl.ZipFile(),chunks=[];
  for(const [name,bytes] of entries)archive.addBuffer(Buffer.from(bytes),name,{compress:false});
  archive.end();for await(const chunk of archive.outputStream)chunks.push(chunk);return Buffer.concat(chunks);
}
test('nested LSIB evidence retains member bytes, hashes and CRC protection',async()=>{
  const base=resolve(tmpdir()),root=await mkdtemp(join(base,'pando-lsib-archive-'));
  assert.ok(root.startsWith(base+sep+'pando-lsib-archive-'));
  try{
    const shp=Buffer.from('synthetic shp'),dbf=Buffer.from('synthetic dbf'),readme=Buffer.from('synthetic readme'),checksum=Buffer.from('synthetic checksum');
    const inner=await zip([['source.shp',shp],['source.dbf',dbf],['ReadMe.txt',readme]]);
    const readRange=async(start,end)=>inner.subarray(start,end+1),members=await zipRangeMembers({size:inner.length,readRange});
    const shape=members.find(value=>value.name==='source.shp');
    assert.deepEqual(await readZipRangeMember({entry:shape,readRange,maxCompressed:128*1024*1024,maxUncompressed:128*1024*1024}),shp);
    await assert.rejects(readZipRangeMember({entry:shape,readRange,maxCompressed:0}),/bounded ZIP member/i);
    await assert.rejects(readZipRangeMember({entry:shape,readRange,maxUncompressed:0}),/bounded ZIP member/i);
    await assert.rejects(readZipRangeMember({entry:shape,readRange,maxCompressed:257*1024*1024}),/bounded ZIP member/i);
    const outer=await zip([['source.zip',inner],['hash.txt',checksum]]),path=join(root,'source.zip');
    await writeFile(path,outer,{flag:'wx'});
    const result=await readLSIBArchiveEvidence({archive:path});
    assert.equal(result.archiveSha256,sha(outer));assert.equal(result.innerArchiveSha256,sha(inner));
    assert.equal(result.shpSha256,sha(shp));assert.equal(result.dbfSha256,sha(dbf));
    await assert.rejects(readLSIBArchiveEvidence({archive:path,requirePinned:true}),/pinned LSIB archive/i);
    assert.deepEqual(result.checksum,checksum);assert.deepEqual(result.readme,readme);
    const changed=Buffer.from(outer),entry=(await zipMembers(path)).find(value=>value.name==='source.zip');
    changed[entry.dataAt+15]^=1;await writeFile(path,changed);
    await assert.rejects(readLSIBArchiveEvidence({archive:path}),/CRC|size|invalid/i);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('selected preserved LSIB archive retains its recorded provenance',{
  skip:!process.env.PANDO_LSIB_ARCHIVE
},async()=>{
  const expected=JSON.parse(await readFile('tools/historical-library/sources/lsib-11.4/provenance.json','utf8'));
  const actual=await readLSIBArchiveEvidence({archive:process.env.PANDO_LSIB_ARCHIVE,requirePinned:true});
  for(const key of ['archiveSha256','innerArchiveSha256','shpSha256','dbfSha256'])assert.equal(actual[key],expected[key],key);
  assert.equal(sha(actual.checksum),'2120372f2e2cb11073d66359745569974166d9f1f6d3a1e8f3885d48e5314cdf');
  assert.equal(sha(actual.readme),'e2c6a159ac1f156d0651b86791eadc4d7cc35a3dc95123426cbe01a369fdfcea');
  assert.equal(actual.checksum.toString('utf8').replaceAll('\r\n','\n'),
    await readFile('tools/historical-library/sources/lsib-11.4/upstream-checksums.txt','utf8'));
  assert.equal(actual.readme.toString('utf8').replaceAll('\r\n','\n'),
    await readFile('tools/historical-library/sources/lsib-11.4/upstream-readme.txt','utf8'));
});
test('remaining source runner receives exact pinned archive evidence',{
  skip:!process.env.PANDO_PYTHON_ORACLE||!process.env.PANDO_LSIB_ARCHIVE
},async()=>{
  const script=`import hashlib,importlib.util,json,os\ns=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nr=m.read_archive_evidence(os.environ['PANDO_LSIB_ARCHIVE'])\nfor k in ['checksum','readme']:r[k]=hashlib.sha256(r[k]).hexdigest()\nprint(json.dumps(r))`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{encoding:'utf8',windowsHide:true,timeout:180000});
  assert.equal(result.status,0,result.stderr);
  const actual=JSON.parse(result.stdout);
  assert.equal(actual.archiveSha256,'1eb5af7e80fce60e48d27eba80ae81fd2b25c9cf59f4f4e2efc89c06ad57490a');
  assert.equal(actual.checksum,'2120372f2e2cb11073d66359745569974166d9f1f6d3a1e8f3885d48e5314cdf');
  assert.equal(actual.readme,'e2c6a159ac1f156d0651b86791eadc4d7cc35a3dc95123426cbe01a369fdfcea');
});
