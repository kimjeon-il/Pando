/** Browser project picker; project commands stay outside. */
export function createBrowserFileAccess({productMode,elements={}}={}){
  if(productMode!=='viewer')throw new TypeError('Browser file access requires viewer product mode.');
  const pending=new Map(),listeners=[];
  let handlers,bound=false,disposed=false;
  const cancelled=()=>({cancelled:true,file:null,files:[]});
  function finish(input,result){const resolve=pending.get(input);pending.delete(input);if(resolve)resolve(result);return !!resolve;}
  function bind(value){
    if(bound)throw new Error('Browser file access already bound.');
    handlers=value;bound=true;
    const input=elements.projectInput;
    if(!input)return;
    const change=()=>{
      const files=Array.from(input.files||[]);input.value='';
      const result=files.length?{cancelled:false,file:files[0],files}:cancelled();
      if(finish(input,result)||result.cancelled)return;
      Promise.resolve().then(()=>handlers.onProjectFile(result.file)).catch(handlers.onError);
    };
    const cancel=()=>finish(input,cancelled());
    input.addEventListener('change',change);input.addEventListener('cancel',cancel);
    listeners.push(()=>{input.removeEventListener('change',change);input.removeEventListener('cancel',cancel);});
  }
  function openProjectFile(){
    if(disposed)throw new Error('Browser file access disposed.');
    if(!bound)throw new Error('Browser file access must be bound before opening files.');
    const input=elements.projectInput;
    if(!input)throw new Error('Browser file input is missing.');
    if(pending.has(input))throw new Error('A file picker is already pending.');
    return new Promise((resolve,reject)=>{pending.set(input,resolve);try{input.click();}catch(error){pending.delete(input);reject(error);}});
  }
  function dispose(){if(disposed)return;disposed=true;for(const remove of listeners)remove();for(const resolve of pending.values())resolve(cancelled());pending.clear();}
  return Object.freeze({bind,dispose,openProjectFile});
}
