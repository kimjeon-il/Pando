// Node CLI for the authenticated native QGIS bridge. The existing Python
// integration remains in use until startup and its MCP tools are replaced.
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {requestNativeQgis} from './native-client.mjs';
import {exportNativeQgis} from './native-export.mjs';
import {normalizeFile} from './normalize.mjs';
import {startNativeQgis} from './native-start.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const usage='Usage: node tools/qgis/native-bridge.mjs [--config FILE] start | status | project | layers [--offset N --limit N] | schema --layer ID | open INPUT | export --layer ID --output NEW_OUTPUT | normalize INPUT --output NEW_OUTPUT';
export async function runNativeBridge(args,{signal}={}){
  signal?.throwIfAborted();
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{config:{type:'string'},layer:{type:'string'},output:{type:'string'},offset:{type:'string'},limit:{type:'string'}}});
  const [command,...rest]=positionals;
  if(command==='normalize'){
    if(rest.length!==1||!values.output||values.layer||values.config||values.offset!==undefined||values.limit!==undefined)throw Error(usage);
    return normalizeFile(rest[0],values.output);
  }
  if(!['start','status','project','layers','schema','open','export'].includes(command))throw Error(usage);
  if((['start','status','project','layers'].includes(command)&&(rest.length||values.layer||values.output))||
    (command==='open'&&(rest.length!==1||values.layer||values.output))||
    (command==='schema'&&(rest.length||!values.layer||values.output))||
    (command==='export'&&(rest.length||!values.layer||!values.output))||
    (command!=='layers'&&(values.offset!==undefined||values.limit!==undefined)))throw Error(usage);
  let offset=0,limit=50;
  if(command==='layers'){
    const parsePage=(value,fallback,max)=>{
      if(value===undefined)return fallback;
      if(!/^(?:0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw Error('Invalid layer pagination');
      return Number(value);
    };
    offset=parsePage(values.offset,0,100000000);limit=parsePage(values.limit,50,100);
    if(limit===0)throw Error('Invalid layer pagination');
  }
  const raw=readFileSync(resolve(values.config||join(root,'.library-data/qgis-native.json')),'utf8');
  let config;
  try{config=JSON.parse(raw);}catch(error){throw new Error('Invalid QGIS configuration JSON',{cause:error});}
  if(command==='start')return startNativeQgis(config,{root,signal});
  if(command==='status')return requestNativeQgis(config,{command:'status'},{signal});
  if(command==='project')return requestNativeQgis(config,{command:'project'},{signal});
  if(command==='layers')return requestNativeQgis(config,{command:'layers',offset,limit},{signal});
  if(command==='schema')return requestNativeQgis(config,{command:'schema',layer:values.layer},{signal});
  if(command==='open'){
    const path=realpathSync(rest[0]);if(!statSync(path).isFile())throw Error('QGIS input must be a regular file');
    return requestNativeQgis(config,{command:'open',path},{signal});
  }
  return exportNativeQgis(config,{layerId:values.layer,output:values.output},{signal});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runNativeBridge(process.argv.slice(2))));}
  catch(error){console.error('qgis-native: '+error.message);process.exitCode=1;}
}
