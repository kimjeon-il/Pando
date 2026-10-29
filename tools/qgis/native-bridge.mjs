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
const usage='Usage: node tools/qgis/native-bridge.mjs [--config FILE] start | status | open INPUT | export --layer ID --output NEW_OUTPUT | normalize INPUT --output NEW_OUTPUT';
export async function runNativeBridge(args){
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{config:{type:'string'},layer:{type:'string'},output:{type:'string'}}});
  const [command,...rest]=positionals;
  if(command==='normalize'){
    if(rest.length!==1||!values.output||values.layer||values.config)throw Error(usage);
    return normalizeFile(rest[0],values.output);
  }
  if(!['start','status','open','export'].includes(command))throw Error(usage);
  if((['start','status'].includes(command)&&(rest.length||values.layer||values.output))||
    (command==='open'&&(rest.length!==1||values.layer||values.output))||
    (command==='export'&&(rest.length||!values.layer||!values.output)))throw Error(usage);
  const raw=readFileSync(resolve(values.config||join(root,'.library-data/qgis-native.json')),'utf8');
  let config;
  try{config=JSON.parse(raw);}catch(error){throw new Error('Invalid QGIS configuration JSON',{cause:error});}
  if(command==='start')return startNativeQgis(config,{root});
  if(command==='status')return requestNativeQgis(config,{command:'status'});
  if(command==='open'){
    const path=realpathSync(rest[0]);if(!statSync(path).isFile())throw Error('QGIS input must be a regular file');
    return requestNativeQgis(config,{command:'open',path});
  }
  return exportNativeQgis(config,{layerId:values.layer,output:values.output});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await runNativeBridge(process.argv.slice(2))));}
  catch(error){console.error('qgis-native: '+error.message);process.exitCode=1;}
}
