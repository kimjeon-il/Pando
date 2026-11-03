import {assertFileAccessPort,assertProjectFileSelection} from './file-access-contract.js';
import {readProjectFile} from './project-file-reader.js';

/** Viewer project opening; the injected transport owns the picker. */
export function createFileController({productMode,readProject=readProjectFile,openProject=null,
  reportOperationError,elements={},projectDomain=null,fileAccess}={}){
  if(productMode!=='viewer')throw new TypeError('File operations require viewer product mode.');
  if(typeof reportOperationError!=='function')throw new TypeError('File operations require their operation error reporter.');
  fileAccess=assertFileAccessPort(fileAccess,{productMode});
  const loadProject=openProject||((read)=>projectDomain.open(read));
  const acceptProject=file=>loadProject(()=>readProject(file));
  let bound=false;
  async function openProjectPicker(){
    try{
      const selected=assertProjectFileSelection(await fileAccess.openProjectFile());
      if(selected.cancelled)return false;
      return await acceptProject(selected.file);
    }finally{elements.projectOpen?.focus?.({preventScroll:true});}
  }
  function bind(){
    if(bound)throw new Error('File controller already bound.');bound=true;
    fileAccess.bind?.({onProjectFile:acceptProject,onError:reportOperationError});
    return api;
  }
  const api=Object.freeze({bind,openProjectPicker,dispose(){fileAccess.dispose?.();}});
  return api;
}
