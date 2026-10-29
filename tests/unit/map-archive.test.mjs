import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setInterval,clearInterval} from 'node:timers';
import test from 'node:test';
import {archiveDirectory,nodeManifest} from '../../tools/reference-analysis/runtime-assets.mjs';
import {zipMembers,zipMemberChunks} from '../../tools/lib/geonames-zip.mjs';

async function fixture(fn) {
  const root=await mkdtemp(join(tmpdir(),'pando-zip-'));
  try {await fn(root);} finally {await rm(root,{recursive:true,force:true});}
}

test('archives Unicode paths without Python and verifies original bytes and ZIP CRC',()=>fixture(async root=>{
  const input=join(root,'input');await mkdir(join(input,'한글'),{recursive:true});
  const values={'한글/지도.txt':Buffer.from('original map\n'),'empty':Buffer.alloc(0)};
  for(const [name,bytes] of Object.entries(values))await writeFile(join(input,name),bytes);
  const result=await archiveDirectory(input,{}),archive=await readFile(result.archive);
  assert.equal(result.archiveBytes,archive.length);
  assert.equal(result.archiveSha256,createHash('sha256').update(archive).digest('hex'));
  const members=await zipMembers(result.archive);
  assert.deepEqual(members.map(row=>row.name).sort(),Object.keys(values).sort());
  for(const member of members) {const chunks=[];for await(const part of zipMemberChunks(result.archive,member))chunks.push(part);assert.deepEqual(Buffer.concat(chunks),values[member.name]);}
}));

test('refuses existing archives and linked source paths without changing them',()=>fixture(async root=>{
  const input=join(root,'input');await mkdir(input);await writeFile(join(input,'file'),'source');
  const output=join(root,'existing.zip');await writeFile(output,'preserve');
  await assert.rejects(archiveDirectory(input,{archive:output}),/exist/i);
  assert.equal(await readFile(output,'utf8'),'preserve');
  await assert.rejects(archiveDirectory(input,{archive:join(input,'inside.zip')}),/outside/i);
  await assert.rejects(readFile(join(input,'inside.zip')),/ENOENT/);
  const linked=join(input,'linked');
  try {await symlink(join(input,'file'),linked,'file');}catch(error){if(process.platform==='win32'&&['EPERM','EACCES'].includes(error.code))return;throw error;}
  await assert.rejects(archiveDirectory(input,{archive:join(root,'links.zip')}),/link/i);
  await assert.rejects(readFile(join(root,'links.zip')),/ENOENT/);
}));

test('cancelled archive leaves no incomplete output',()=>fixture(async root=>{
  const input=join(root,'input');await mkdir(input);await writeFile(join(input,'file'),'source');
  const controller=new globalThis.AbortController();controller.abort();
  await assert.rejects(archiveDirectory(input,{signal:controller.signal}));
  await assert.rejects(readFile(input+'.zip'),/ENOENT/);
}));
test('cancellation during archive writing removes only its partial ZIP',()=>fixture(async root=>{
  const input=join(root,'input');await mkdir(input);const original=randomBytes(4*1024*1024);
  await writeFile(join(input,'file'),original);
  const controller=new globalThis.AbortController(),output=input+'.zip';
  const timer=setInterval(()=>{if(existsSync(output))controller.abort();},1);
  try {await assert.rejects(archiveDirectory(input,{signal:controller.signal}),/abort/i);}finally{clearInterval(timer);}
  await assert.rejects(readFile(output),/ENOENT/);assert.deepEqual(await readFile(join(input,'file')),original);
}));

test('diagnostic runtime includes the ZIP writer needed by its own imports',()=>{
  assert.equal(nodeManifest(undefined,{diagnostics:true}).dependencies.yazl,'3.3.1');
  assert.equal(nodeManifest().dependencies.yazl,undefined);
});
