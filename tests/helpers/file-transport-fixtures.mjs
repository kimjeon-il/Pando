import {createBrowserFileAccess} from "../../src/data/browser-file-access.js";

export const fixtureProjectFile=()=>new globalThis.File([new Uint8Array([0,1,2,255])],'project.gpkg',{type:'application/geopackage+sqlite3'});
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
