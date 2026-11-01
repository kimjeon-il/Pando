import assert from 'node:assert/strict';
import test from 'node:test';
import {createBrowserFileAccess} from '../../shared/frontend/js/modules/browser-file-access.js';
import {
  assertFileAccessPort,assertFileWriteReceipt,assertGisFileSelection,
  assertProjectFileSelection,assertProjectSaveDestination,
} from '../../shared/frontend/js/modules/file-access-contract.js';
import {createNativeStorage,decodeBytes,encodeBytes} from '../../apps/editor/native-storage.js';

const {Blob,File}=globalThis;
const projectFile=()=>new File([new Uint8Array([0,1,2,255])],'project.gpkg',{type:'application/geopackage+sqlite3'});
const gisFiles=()=>[new File(['shape'],'map.shp'),new File(['dbf'],'map.dbf')];

function browserFixture(){
  const selections={project:'cancel',gis:'cancel'};
  const listeners={};
  const makeInput=kind=>({
    files:[],value:'',
    addEventListener(name,fn){(listeners[kind]??={})[name]=fn;},
    removeEventListener(name){delete listeners[kind]?.[name];},
    click(){queueMicrotask(()=>{
      const mode=selections[kind],entry=listeners[kind];
      if(mode==='cancel'){entry.cancel();return;}
      this.files=kind==='project'?[projectFile()]:gisFiles();entry.change();
    });},
  });
  const projectInput=makeInput('project'),input=makeInput('gis'),writes=[],downloads=[];
  const window={
    showSaveFilePicker:async()=>({createWritable:async()=>({
      async write(blob){writes.push(blob);},async close(){},async abort(){},
    })}),
    URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},
    setTimeout(fn){fn();},
  };
  const document={
    createElement(){return {click(){downloads.push(this.download);},remove(){}};},
    body:{appendChild(){}},
  };
  const access=createBrowserFileAccess({productMode:'editor',elements:{projectInput,input},window,document});
  access.bind({onProjectFile(){},onGisFiles(){},onError:error=>{throw error;}});
  return {access,set(kind,mode){selections[kind]=mode;},writes,downloads};
}

function nativeFixture(){
  const selections={project:'cancel',gis:'cancel'},reading=new Map(),writing=new Map(),writes=[];
  let token=0;
  const invoke=async(command,args={})=>{
    if(command==='begin_document_read'){
      const mode=selections[args.kind];
      if(mode==='cancel')return {cancelled:true,files:[]};
      const rows=args.kind==='project'?[projectFile()]:gisFiles();
      const files=[];
      for(const file of rows){
        const bytes=new Uint8Array(await file.arrayBuffer()),id=++token;
        reading.set(id,{bytes,done:false});
        files.push({token:id,path:'C:/fixture/'+file.name,bytes:bytes.length});
      }
      return {cancelled:false,files};
    }
    if(command==='read_document_chunk'){
      const row=reading.get(args.token);reading.delete(args.token);
      return {contents:encodeBytes(row.bytes),done:true};
    }
    if(command==='begin_document_write'){const id=++token;writing.set(id,[]);return {token:id};}
    if(command==='append_document_chunk'){writing.get(args.token).push(decodeBytes(args.contents));return {};}
    if(command==='finish_document_write'){
      writes.push(Buffer.concat(writing.get(args.token).map(value=>Buffer.from(value))));
      writing.delete(args.token);return {cancelled:false,path:'C:/fixture/output.gpkg'};
    }
    if(command==='abort_document_transfer'){reading.delete(args.token);writing.delete(args.token);return true;}
    throw new Error('Unexpected native command '+command);
  };
  return {access:createNativeStorage(invoke),set(kind,mode){selections[kind]=mode;},writes};
}

function registerEditorFileAccessContract(name,fixtureFactory){
  test(name+' satisfies the shared editor file-access contract',async()=>{
    const f=fixtureFactory(),access=assertFileAccessPort(f.access,{productMode:'editor'});

    f.set('project','cancel');
    assert.equal(assertProjectFileSelection(await access.openProjectFile()).cancelled,true);
    f.set('project','success');
    const project=assertProjectFileSelection(await access.openProjectFile());
    assert.equal(project.cancelled,false);assert.equal(project.file.name,'project.gpkg');

    f.set('gis','cancel');
    assert.equal(assertGisFileSelection(await access.openGisFiles()).cancelled,true);
    f.set('gis','success');
    const gis=assertGisFileSelection(await access.openGisFiles());
    assert.deepEqual(gis.files.map(file=>file.name),['map.shp','map.dbf']);

    const blob=new Blob(['project-bytes']);
    const destination=assertProjectSaveDestination(await access.prepareProjectSave());
    const saved=assertFileWriteReceipt(await destination.write(blob));
    assert.equal(typeof saved.downloaded,'boolean');
    await assert.rejects(destination.write(blob),/finished/i);

    const exported=assertFileWriteReceipt(await access.saveExportFile('판도연구소-GIS-데이터.gpkg',new Blob(['GIS'])));
    assert.equal(typeof exported.downloaded,'boolean');
    access.dispose?.();
  });
}

registerEditorFileAccessContract('browser transport',browserFixture);
registerEditorFileAccessContract('native transport',nativeFixture);

test('shared file-access result validators fail closed on malformed transport output',()=>{
  assert.throws(()=>assertProjectFileSelection({cancelled:false,file:new Blob(['x'])}),/named File/);
  assert.throws(()=>assertGisFileSelection({cancelled:false,files:[]}),/requires files/);
  assert.throws(()=>assertProjectSaveDestination({write(){}}),/abort/);
  assert.throws(()=>assertFileWriteReceipt({downloaded:'yes'}),/downloaded/);
});
