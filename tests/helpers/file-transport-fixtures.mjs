import {createBrowserFileAccess} from '../../shared/frontend/js/modules/browser-file-access.js';
import {createNativeStorage} from '../../apps/editor/native-storage.js';
import {DOCUMENT_TRANSFER_COMMANDS,DOCUMENT_TRANSFER_LIMITS} from '../../apps/editor/document-transfer-contract.js';

export const fixtureProjectFile=()=>new File([new Uint8Array([0,1,2,255])],'project.gpkg',{type:'application/geopackage+sqlite3'});
export function createBrowserFileAccessFixture({productMode='viewer',autoPick=true,projectFiles=()=>[fixtureProjectFile()]}={}){
  const selections={project:'cancel'},events=[];
  const inputs={};
  const fire=(kind,mode=selections[kind],files=projectFiles())=>{
    const input=inputs[kind];
    if(!input)throw new Error('Unknown browser file input: '+kind);
    if(mode==='cancel'){input.listeners.cancel?.();return;}
    input.files=files;input.value='selected';input.listeners.change?.();
  };
  const makeInput=kind=>inputs[kind]={
    listeners:{},files:[],value:'',
    addEventListener(name,fn){this.listeners[name]=fn;},
    removeEventListener(name){delete this.listeners[name];},
    click(){events.push('picker');if(autoPick)queueMicrotask(()=>fire(kind));},
  };
  const elements={projectInput:makeInput('project'),projectOpen:{id:'openProjectBtn',focus(){events.push('focus');}}};
  const access=createBrowserFileAccess({productMode,elements});
  return Object.freeze({
    access,elements,events,
    set(kind,mode){if(!Object.hasOwn(selections,kind))throw new Error('Unknown browser file selection: '+kind);selections[kind]=mode;},
    fire,
  });
}

const asBytes=value=>value instanceof Uint8Array?value:new Uint8Array(value);
const encode=value=>Buffer.from(value).toString('base64');
const decode=value=>new Uint8Array(Buffer.from(value,'base64'));

export function createNativeDocumentTransferFixture({readFiles=[],path='C:/picked.gpkg'}={}){
  const source=Array.isArray(readFiles)?{project:readFiles,gis:readFiles}:{project:readFiles.project||[],gis:readFiles.gis||[]};
  const selection={project:null,gis:null},writes=[],chunks=[],events=[],reading=new Map(),writing=new Map();
  let next=0;
  const invoke=async(command,args={})=>{
    events.push(command);
    if(command===DOCUMENT_TRANSFER_COMMANDS.beginWrite){writing.set(++next,[]);return {token:next};}
    if(command===DOCUMENT_TRANSFER_COMMANDS.appendWrite){
      const chunk=decode(args.contents);
      if(chunk.length>DOCUMENT_TRANSFER_LIMITS.chunkBytes)throw new Error('Fixture chunk exceeds protocol limit.');
      chunks.push(chunk);writing.get(args.token)?.push(chunk);return {};
    }
    if(command===DOCUMENT_TRANSFER_COMMANDS.finishWrite){
      const pending=writing.get(args.token);
      if(!pending)throw new Error('Unknown fixture write token.');
      writes.push(Buffer.concat(pending.map(value=>Buffer.from(value))));
      writing.delete(args.token);return {cancelled:false,path};
    }
    if(command===DOCUMENT_TRANSFER_COMMANDS.beginRead){
      const rows=source[args.kind]||[];
      const mode=selection[args.kind]??(rows.length?'success':'cancel');
      if(mode==='cancel')return {cancelled:true,files:[]};
      const files=rows.map(row=>{
        const token=++next,data=asBytes(row.bytes);
        reading.set(token,{bytes:data,cursor:0});
        return {token,path:row.path,bytes:data.length};
      });
      return {cancelled:false,files};
    }
    if(command===DOCUMENT_TRANSFER_COMMANDS.readChunk){
      const row=reading.get(args.token);
      if(!row)throw new Error('Invalid fixture read token.');
      const part=row.bytes.slice(row.cursor,row.cursor+DOCUMENT_TRANSFER_LIMITS.chunkBytes);
      row.cursor+=part.length;
      const done=row.cursor===row.bytes.length;
      if(done)reading.delete(args.token);
      return {contents:encode(part),done};
    }
    if(command===DOCUMENT_TRANSFER_COMMANDS.abort){writing.delete(args.token);reading.delete(args.token);return true;}
    throw new Error('Unexpected fixture native command '+command);
  };
  return Object.freeze({
    invoke,writes,chunks,events,readFiles:source,
    set(kind,mode){if(!Object.hasOwn(selection,kind))throw new Error('Unknown native selection: '+kind);selection[kind]=mode;},
  });
}

export function createNativeFileAccessFixture({
  path='C:/fixture/output.gpkg',
  projectRows=[{path:'C:/fixture/project.gpkg',bytes:new Uint8Array([0,1,2,255])}],
  gisRows=[
    {path:'C:/fixture/map.shp',bytes:new TextEncoder().encode('shape')},
    {path:'C:/fixture/map.dbf',bytes:new TextEncoder().encode('dbf')},
  ],
}={}){
  const transport=createNativeDocumentTransferFixture({readFiles:{project:projectRows,gis:gisRows},path});
  return Object.freeze({...transport,access:createNativeStorage(transport.invoke)});
}
