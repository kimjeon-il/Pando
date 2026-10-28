import assert from 'node:assert/strict';
import { test } from 'node:test';
import {randomUUID} from 'node:crypto';
import { createProbeStorage } from '../probe-storage.js';
import { createNativeStorage, encodeBytes, decodeBytes } from '../native-storage.js';
const writeProject=async(storage,blob)=>(await storage.prepareProjectSave()).write(blob);

function simulatedNative(files = [], path = 'C:/picked.gpkg') {
  const writes = [], chunks = [], events = [], reading = new Map();
  const writing = new Map();
  let next = 0;
  const invoke = async (command, args = {}) => {
    events.push(command);
    if (command === 'begin_document_write') { writing.set(++next,[]);return { token: next }; }
    if (command === 'append_document_chunk') {
      const bytes = decodeBytes(args.contents);
      assert.ok(bytes.length <= 256 * 1024);
      chunks.push(bytes);
      writing.get(args.token).push(bytes);
      return {};
    }
    if (command === 'finish_document_write') {
      writes.push(Buffer.concat(writing.get(args.token).map(c => Buffer.from(c))));writing.delete(args.token);
      return { cancelled: false, path };
    }
    if (command === 'begin_document_read') {
      const selected = files.map(row => {
        const token = ++next;
        reading.set(token, { bytes: row.bytes, cursor: 0 });
        return { token, path: row.path, bytes: row.bytes.length };
      });
      return selected.length ? { cancelled: false, files: selected } : { cancelled: true, files: [] };
    }
    if (command === 'read_document_chunk') {
      const row = reading.get(args.token);
      if (!row) throw new Error('Invalid transfer token.');
      const part = row.bytes.slice(row.cursor, row.cursor + 256 * 1024);
      row.cursor += part.length;
      const done = row.cursor === row.bytes.length;
      if (done) reading.delete(args.token);
      return { contents: encodeBytes(part), done };
    }
    if (command === 'abort_document_transfer') { writing.delete(args.token);reading.delete(args.token);return true; }
    throw new Error('Unexpected command ' + command);
  };
  return { invoke, writes, chunks, events };
}

test('ordinary storage exposes error reporting but no verification commands', async () => {
  const calls = [];
  const storage = createNativeStorage(async (...args) => { calls.push(args); return { path: 'diagnostic-report.json' }; });
  assert.equal(storage.writeProbeFile, undefined);
  assert.equal(storage.readProbeFile, undefined);
  assert.equal(storage.finishDiagnostics, undefined);
  await storage.writeDiagnosticReport({ ok: false, error: { message: 'startup failed' } });
  assert.equal(calls[0][0], 'write_diagnostic_report');
});
test('project bridge roundtrips binary bytes through bounded native chunks', async () => {
  const bytes = new Uint8Array([0, 255, 1, 128, 39, 10]);
  const native = simulatedNative([{ path: 'C:/picked.gpkg', bytes }]);
  const storage = createNativeStorage(native.invoke);
  assert.equal((await writeProject(storage,new Blob([bytes]))).cancelled, false);
  assert.deepEqual(new Uint8Array(native.writes[0]), bytes);
  const opened = await storage.openProjectFile();
  assert.deepEqual(new Uint8Array(await opened.file.arrayBuffer()), bytes);
});
test('a document above the prior 1 MiB cap is transferred without a whole-file Base64 value', async () => {
  const bytes = new Uint8Array(1024 * 1024 + 271);
  bytes[bytes.length - 1] = 187;
  const native = simulatedNative([{ path: 'C:/large.gpkg', bytes }]);
  const storage = createNativeStorage(native.invoke);
  await writeProject(storage,new Blob([bytes]));
  assert.equal(native.chunks.length, 5);
  assert.equal(native.writes[0].length, bytes.length);
  const selected = await storage.openProjectFile();
  assert.deepEqual(new Uint8Array(await selected.file.arrayBuffer()), bytes);
});
test('oversized document is blocked before IPC while tiny probe remains bounded', async () => {
  let invoked = false;
  const storage = createNativeStorage(async () => { invoked = true; });
  const largeBlob = Object.create(Blob.prototype);
  Object.defineProperty(largeBlob, 'size', { value: 256 * 1024 * 1024 + 1 });
  await assert.rejects(writeProject(storage,largeBlob), /256 MiB/);
  assert.equal(invoked, false);
  assert.throws(() => createProbeStorage(async () => { invoked = true; }).writeProbeFile('a'.repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.equal(invoked, false);
});
test('cancelled user selection is not counted as saved project', async () => {
  const storage = createNativeStorage(async command => {
    if (command === 'begin_document_write') return { token: 1 };
    if (command === 'append_document_chunk') return {};
    if (command === 'finish_document_write') return { cancelled: true, path: null };
    if (command === 'begin_document_read') return { cancelled: true, files: [] };
    throw new Error('Unexpected command ' + command);
  });
  await assert.rejects(writeProject(storage,new Blob(['project'])),{name:'AbortError'});
  assert.deepEqual(await storage.openProjectFile(), { cancelled: true, path: null, file: null });
});
test('GIS ZIP and multiselect retain native formats and filename identity', async () => {
  const native = simulatedNative([
    { path: 'C:/maps/part.shp', bytes: new Uint8Array([0, 255]) },
    { path: 'content://documents/primary%3ADownload%2Fpart.dbf', bytes: new Uint8Array([1, 2, 3]) },
  ]);
  const storage = createNativeStorage(native.invoke);
  const result = await storage.openGisFiles();
  assert.deepEqual(result.files.map(f => f.name), ['part.shp', 'part.dbf']);
  assert.deepEqual(new Uint8Array(await result.files[0].arrayBuffer()), new Uint8Array([0, 255]));
  await storage.saveExportFile('판도연구소-GIS-데이터.zip', new Blob(['ZIP']));
  await assert.rejects(storage.saveExportFile('arbitrary.exe', new Blob(['X'])), /Unsupported/);
});
test('native errors abort the transfer and leave the owning file state unchanged', async () => {
  const calls = [];
  const storage = createNativeStorage(async (command) => {
    calls.push(command);
    if (command === 'begin_document_write') return { token: 100 };
    if (command === 'append_document_chunk') throw new Error('disk full');
    if (command === 'abort_document_transfer') return true;
    throw new Error('Unexpected command ' + command);
  });
  await assert.rejects(writeProject(storage,new Blob(['data'])), /disk full/);
  assert.deepEqual(calls, ['begin_document_write','append_document_chunk','abort_document_transfer']);
});

for(const [platform,path] of [['windows','C:/maps/판도.gpkg'],['android','content://documents/primary%3ADownload%2F%ED%8C%90%EB%8F%84.gpkg']]){
 test(`${platform} file controller preserves the actual Core document through native save, reopen, cancellation and failures`,{timeout:60000},async t=>{
  const [{createFileController},{createInitialDocument},{createNodeCoreProject},{productionGeoPackage}]=await Promise.all([
   import('../../../shared/frontend/js/modules/file-controller.js'),import('../../../shared/frontend/js/modules/initial-document.js'),
   import('../../../tests/helpers/core-project.mjs'),import('../../../tests/helpers/production-geopackage.mjs')]);
  const selected=[],native=simulatedNative(selected,path),statuses=[],errors=[];
  let mode='',release,entered;
  const failure=new Error('native transfer failed');
  const storage=createNativeStorage(async(command,args)=>{
   if(mode==='hold'&&command==='finish_document_write'){entered();await new Promise(resolve=>{release=resolve;});}
   if(mode==='write-failure'&&command==='append_document_chunk')throw failure;
   if(mode==='read-failure'&&command==='read_document_chunk')throw failure;
   if(mode==='cancel-save'&&command==='finish_document_write')return {cancelled:true};
   if(mode==='cancel-open'&&command==='begin_document_read')return {cancelled:true};
   return native.invoke(command,args);
  });
  const owner=await createNodeCoreProject(createInitialDocument({appVersion:'0.36.0'}),{appVersion:'0.36.0',replaceSnapshot:()=>true,
   createProjectFile:async(project,{spatialState})=>new Blob([(await productionGeoPackage('write',new ArrayBuffer(0),project,spatialState)).buffer])});
  t.after(()=>owner.dispose());
  const create=async name=>{
   const id=randomUUID();
   const ack=await owner.project.executeCommand({commandId:'generic.create',targets:[{domain:'generic',id}],payload:{feature:{type:'Feature',id,
    geometry:{type:'Point',coordinates:[1,2]},properties:{schemaVersion:2,name,notes:'',color:'#8c68d8',locked:false,source:{kind:'drawn',license:'',details:{}}}}}});
   assert.equal(ack.ok,true,JSON.stringify(ack.error));
  };
  const controller=createFileController({productMode:'editor',elements:{save:{disabled:false}},fileAccess:storage,projectDomain:owner.project,
   readProject:async file=>(await productionGeoPackage('read',await file.arrayBuffer())).metadata.projectState,
   setActionStatus:(...args)=>statuses.push(args),reportOperationError:(...args)=>errors.push(args)});
  controller.bind();t.after(()=>controller.dispose());t.mock.method(console,'error',(...args)=>errors.push(args));
  await create('saved');
  mode='hold';const waiting=new Promise(resolve=>{entered=resolve;}),saving=controller.saveProject();
  await Promise.race([waiting,saving.then(()=>assert.fail('save ended before native write: '+errors.map(row=>row.map(value=>value?.stack||value).join(' ')).join('\n')))]);
  assert.equal(await controller.saveProject(),false);release();assert.equal(await saving,true);mode='';
  assert.equal(native.writes.length,1);assert.equal(native.writes[0].subarray(0,16).toString(),'SQLite format 3\0');
  assert.equal(owner.project.state().dirty,false);
  selected.push({path,bytes:native.writes[0]});await create('unsaved');const before=owner.documentModel.snapshot();
  mode='cancel-open';assert.equal(await controller.openProjectPicker(),false);assert.deepEqual(owner.documentModel.snapshot(),before);
  mode='read-failure';await assert.rejects(controller.openProjectPicker(),error=>error===failure);assert.deepEqual(owner.documentModel.snapshot(),before);
  for(const cancelled of ['cancel-save','write-failure']){
   mode=cancelled;const successes=statuses.filter(row=>row[1]==='success').length;
   assert.equal(await controller.saveProject(),false);assert.equal(owner.project.state().dirty,true);
   assert.equal(statuses.filter(row=>row[1]==='success').length,successes);assert.deepEqual(owner.documentModel.snapshot(),before);
  }
  assert.ok(errors.some(args=>args.includes(failure)));assert.ok(native.events.includes('abort_document_transfer'));
  mode='';await controller.openProjectPicker();
  assert.deepEqual(owner.documentModel.snapshot().genericFeatures.map(row=>row.properties.name),['saved']);assert.equal(owner.project.state().dirty,false);
 });
}
