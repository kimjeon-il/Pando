import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,isAbsolute} from 'node:path';
export function preparedDependencyConfiguration(config,{root=fileURLToPath(new URL('./',import.meta.url)),ci=!!process.env.CI}={}){
 const pointer=resolve(root,'.library-data/dependencies.json');
 if(ci||!existsSync(pointer))return config;
 const state=JSON.parse(readFileSync(pointer,'utf8'));
 if(state.schema!=='pando-dependency-store-v1'||!isAbsolute(state.store))throw Error('Invalid Pando dependency store reference; run deps:prepare');
 return {...config,storeDir:state.store,enableGlobalVirtualStore:true,packageImportMethod:'hardlink'};
}
export const hooks={updateConfig:config=>preparedDependencyConfiguration(config)};
