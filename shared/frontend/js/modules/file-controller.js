import {assertFileAccessPort,assertFileWriteReceipt,assertGisFileSelection,assertProjectFileSelection,assertProjectSaveDestination} from './file-access-contract.js';
import {readProjectFile} from './project-file-reader.js';
/** File workflow only; the injected transport owns dialogs, paths and bytes. */
export function createFileController({productMode,readProject=readProjectFile,openProject=null,
  reportOperationError,elements,onFiles,setTarget=()=>{},requireCanonicalData=()=>true,
  projectDomain=null,fileAccess,setActionStatus=()=>{}}={}){
  if(!['viewer','editor'].includes(productMode))throw new TypeError('File operations require immutable product mode.');
  if(typeof reportOperationError!=='function')throw new TypeError('File operations require their operation error reporter.');
  if(!fileAccess)throw new TypeError('File operations require an explicit file-access port.');
  fileAccess=assertFileAccessPort(fileAccess,{productMode});
  const loadProject=openProject||((read)=>projectDomain.open(read));
  const acceptProject=file=>loadProject(()=>readProject(file));
  const acceptGis=files=>{if(productMode!=='editor')throw new Error('GIS import is unavailable in this product.');return onFiles(files,{sourceKind:'vector'});};
  let saving=false,bound=false;
  async function openPicker({target='',trigger=null}={}){
    setTarget(target);const focus=trigger||elements.open;
    try{
      const selected=assertGisFileSelection(await fileAccess.openGisFiles());
      if(selected.cancelled){setTarget('');return false;}
      if(!Array.isArray(selected.files)||!selected.files.length)throw new Error('선택한 GIS 파일이 없습니다.');
      return await acceptGis(selected.files);
    }catch(error){setTarget('');throw error;}
    finally{focus?.focus?.({preventScroll:true});}
  }
  async function openProjectPicker(){
    setTarget('');
    try{
      const selected=assertProjectFileSelection(await fileAccess.openProjectFile());
      if(selected.cancelled)return false;
      return await acceptProject(selected.file);
    }finally{elements.projectOpen?.focus?.({preventScroll:true});}
  }
  function bind(){
    if(bound)throw new Error('File controller already bound.');bound=true;
    if(fileAccess.bind)fileAccess.bind({onProjectFile:acceptProject,onGisFiles:acceptGis,onError:reportOperationError});
    return api;
  }
  async function saveProject(){
    if(saving||!requireCanonicalData())return false;
    saving=true;const button=elements.save;if(button)button.disabled=true;
    let destination,finished=false;
    try{
      // Call the platform port before encoding while the user gesture is active.
      destination=assertProjectSaveDestination(await fileAccess.prepareProjectSave());
      return await projectDomain.save(async blob=>{
        const result=assertFileWriteReceipt(await destination.write(blob));finished=true;
        setActionStatus(result.downloaded?'브라우저 다운로드 폴더에 저장 완료':'프로젝트 저장 완료','success',result.downloaded?4800:3200);
        return result;
      });
    }catch(error){
      if(error?.name==='AbortError'){setActionStatus('저장 취소','ready',2200);return false;}
      console.error('[PL-GPKG-001]',error);setActionStatus('프로젝트 저장 실패','error',0);return false;
    }finally{
      if(destination&&!finished){try{await destination.abort();}catch(error){reportOperationError(error,'파일 전송 정리를 완료하지 못했습니다.','PL-FILE-ABORT-001');}}
      saving=false;if(button)button.disabled=false;
    }
  }
  const api=Object.freeze({bind,openProjectPicker,dispose(){if(fileAccess.dispose)fileAccess.dispose();},
    ...(productMode==='editor'?{openPicker,saveProject,saveExportFile:async(filename,blob)=>assertFileWriteReceipt(await fileAccess.saveExportFile(filename,blob))}:{})});
  return api;
}
