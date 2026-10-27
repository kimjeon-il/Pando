/** Browser file dialogs and download transport; project commands stay outside. */
export function createBrowserFileAccess({productMode,elements={},window=globalThis,document=globalThis.document}={}){
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Browser file access requires product mode.');
  const pending=new Map(),listeners=[];
  let handlers,bound=false,disposed=false;
  const cancelled=()=>({cancelled:true,file:null,files:[]});
  function finish(input,result){const resolve=pending.get(input);pending.delete(input);if(resolve)resolve(result);return !!resolve;}
  function bind(value){
    if(bound)throw new Error('Browser file access already bound.');
    handlers=value;bound=true;
    for(const [input,kind]of [[elements.projectInput,'project'],...(productMode==='editor'?[[elements.input,'gis']]:[])]){
      if(!input)continue;
      const change=()=>{
        const files=Array.from(input.files||[]);input.value='';
        const result=files.length?{cancelled:false,file:files[0],files}:cancelled();
        if(finish(input,result)||result.cancelled)return;
        Promise.resolve().then(()=>kind==='project'?handlers.onProjectFile(result.file):handlers.onGisFiles(files)).catch(handlers.onError);
      };
      const cancel=()=>finish(input,cancelled());
      input.addEventListener('change',change);input.addEventListener('cancel',cancel);
      listeners.push(()=>{input.removeEventListener('change',change);input.removeEventListener('cancel',cancel);});
    }
  }
  function pick(input){
    if(disposed)throw new Error('Browser file access disposed.');
    if(!bound)throw new Error('Browser file access must be bound before opening files.');
    if(!input)throw new Error('Browser file input is missing.');
    if(pending.has(input))throw new Error('A file picker is already pending.');
    return new Promise((resolve,reject)=>{pending.set(input,resolve);try{input.click();}catch(error){pending.delete(input);reject(error);}});
  }
  function download(filename,blob){
    const url=window.URL.createObjectURL(blob),anchor=document.createElement('a');
    try{anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();}
    finally{anchor.remove();window.setTimeout(()=>window.URL.revokeObjectURL(url),1000);}
    return {downloaded:true};
  }
  async function prepareProjectSave(){
    const filename='판도연구소-프로젝트.gpkg';
    const handle=typeof window.showSaveFilePicker==='function'?await window.showSaveFilePicker({suggestedName:filename,
      types:[{description:'판도연구소 프로젝트',accept:{'application/geopackage+sqlite3':['.gpkg']}}]}):null;
    let ended=false,writable;
    return Object.freeze({
      async write(blob){
        if(ended)throw new Error('File writer already finished.');
        if(!handle){const receipt=download(filename,blob);ended=true;return receipt;}
        writable=await handle.createWritable();await writable.write(blob);await writable.close();ended=true;
        return {downloaded:false};
      },
      async abort(){if(ended)return;ended=true;if(writable)await writable.abort();},
    });
  }
  function dispose(){if(disposed)return;disposed=true;for(const remove of listeners)remove();for(const resolve of pending.values())resolve(cancelled());pending.clear();}
  return Object.freeze({bind,dispose,openProjectFile:()=>pick(elements.projectInput),
    ...(productMode==='editor'?{openGisFiles:()=>pick(elements.input),prepareProjectSave,saveExportFile:async(filename,blob)=>download(filename,blob)}:{})});
}
