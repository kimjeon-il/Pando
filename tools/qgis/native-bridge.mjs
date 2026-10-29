// Node CLI for the authenticated native QGIS bridge. The existing Python
// integration remains in use until startup and its MCP tools are replaced.
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {requestNativeQgis} from './native-client.mjs';
import {exportNativeQgis} from './native-export.mjs';
import {normalizeFile,normalizeSourceAttribute,parseJson,stringifyJson} from './normalize.mjs';
import {startNativeQgis} from './native-start.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const usage='Usage: node tools/qgis/native-bridge.mjs [--config FILE] start | status | project | layers [--offset N --limit N] | schema --layer ID | set-visibility --layer ID --visible true|false | features --layer ID [--offset N --limit N --expression TEXT --geometry] | select --layer ID (--fids JSON | --expression TEXT) | selection --layer ID | clear-selection --layer ID | begin-edit|commit-edit|rollback-edit|undo-edit|redo-edit --layer ID | set-attribute --layer ID --fid FID --field FIELD --json JSON | set-geometry --layer ID --fid FID --wkt WKT | delete-feature --layer ID --fid FID | add-feature --layer ID --wkt WKT --json ATTRIBUTES | open INPUT | export --layer ID --output NEW_OUTPUT | normalize INPUT --output NEW_OUTPUT';
export async function runNativeBridge(args,{signal}={}){
  signal?.throwIfAborted();
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{config:{type:'string'},layer:{type:'string'},output:{type:'string'},offset:{type:'string'},limit:{type:'string'},fids:{type:'string'},expression:{type:'string'},fid:{type:'string'},field:{type:'string'},json:{type:'string'},wkt:{type:'string'},visible:{type:'string'},geometry:{type:'boolean'}}});
  const [command,...rest]=positionals;
  if(command==='normalize'){
    if(rest.length!==1||!values.output||values.layer||values.config||values.offset!==undefined||values.limit!==undefined||values.fids!==undefined||values.expression!==undefined||values.fid!==undefined||values.field!==undefined||values.json!==undefined||values.wkt!==undefined||values.visible!==undefined||values.geometry!==undefined)throw Error(usage);
    return normalizeFile(rest[0],values.output);
  }
  if(!['start','status','project','layers','schema','set-visibility','features','select','selection','clear-selection','begin-edit','commit-edit','rollback-edit','undo-edit','redo-edit','set-attribute','set-geometry','delete-feature','add-feature','open','export'].includes(command))throw Error(usage);
  if((['start','status','project','layers'].includes(command)&&(rest.length||values.layer||values.output))||
    (command==='open'&&(rest.length!==1||values.layer||values.output))||
    (['schema','set-visibility'].includes(command)&&(rest.length||!values.layer||values.output))||
    (command==='set-visibility'&&!['true','false'].includes(values.visible))||
    (command!=='set-visibility'&&values.visible!==undefined)||
    (['features','select','selection','clear-selection','begin-edit','commit-edit','rollback-edit','undo-edit','redo-edit','set-attribute','set-geometry','delete-feature','add-feature'].includes(command)&&(rest.length||!values.layer||values.output))||
    (command==='set-attribute'&&(!values.fid||!values.field||values.json===undefined))||
    (command==='set-geometry'&&(!values.fid||!values.wkt))||
    (command==='delete-feature'&&!values.fid)||
    (command==='add-feature'&&(!values.wkt||values.json===undefined))||
    (!['set-attribute','set-geometry','delete-feature'].includes(command)&&values.fid!==undefined)||
    (command!=='set-attribute'&&values.field!==undefined)||
    (!['set-attribute','add-feature'].includes(command)&&values.json!==undefined)||
    (!['set-geometry','add-feature'].includes(command)&&values.wkt!==undefined)||
    (command==='select'&&((values.fids===undefined)===(values.expression===undefined)))||
    (command!=='select'&&values.fids!==undefined)||
    (!['select','features'].includes(command)&&values.expression!==undefined)||
    (command!=='features'&&values.geometry!==undefined)||
    (command==='export'&&(rest.length||!values.layer||!values.output))||
    (!['layers','features'].includes(command)&&(values.offset!==undefined||values.limit!==undefined)))throw Error(usage);
  let offset=0,limit=50;
  if(command==='layers'||command==='features'){
    const parsePage=(value,fallback,max)=>{
      if(value===undefined)return fallback;
      if(!/^(?:0|[1-9]\d*)$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>max)throw Error('Invalid layer pagination');
      return Number(value);
    };
    offset=parsePage(values.offset,0,100000000);limit=parsePage(values.limit,command==='features'?10:50,100);
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
  if(command==='set-visibility')return requestNativeQgis(config,{command,layer:values.layer,visible:values.visible==='true'},{signal});
  if(command==='features'){
    if(values.expression!==undefined&&(!values.expression.trim()||values.expression.length>10000))throw Error('A bounded nonempty feature expression is required');
    const query={command,layer:values.layer,offset,limit,geometry:values.geometry===true};
    if(values.expression!==undefined)query.expression=values.expression;
    const result=await requestNativeQgis(config,query,{signal});
    if(!Array.isArray(result.features))throw Error('Invalid QGIS feature page');
    result.features=result.features.map(({attributesJson,...feature})=>{
      if(typeof attributesJson!=='string')throw Error('Invalid QGIS feature attributes');
      const attributes=parseJson(attributesJson);
      if(!attributes||typeof attributes!=='object'||Array.isArray(attributes))throw Error('Invalid QGIS feature attributes');
      return {...feature,attributes:normalizeSourceAttribute(attributes)};
    });
    return result;
  }
  if(command==='select'){
    if(values.expression!==undefined){
      if(!values.expression.trim()||values.expression.length>10000)throw Error('A bounded nonempty selection expression is required');
      return requestNativeQgis(config,{command:'select',layer:values.layer,expression:values.expression},{signal});
    }
    let fids;try{fids=JSON.parse(values.fids);}catch{throw Error('Feature IDs must be a JSON array of decimal strings');}
    if(!Array.isArray(fids)||fids.length>10000||fids.some(fid=>typeof fid!=='string'||! /^-?(0|[1-9]\d*)$/.test(fid)||BigInt(fid)<-9223372036854775808n||BigInt(fid)>9223372036854775807n))
      throw Error('Feature IDs must be a bounded array of signed 64-bit decimal strings');
    return requestNativeQgis(config,{command:'select',layer:values.layer,fids},{signal});
  }
  if(command==='selection'||command==='clear-selection')return requestNativeQgis(config,{command,layer:values.layer},{signal});
  if(['begin-edit','commit-edit','rollback-edit','undo-edit','redo-edit'].includes(command))return requestNativeQgis(config,{command,layer:values.layer},{signal});
  if(command==='add-feature'){
    if(!values.wkt||values.wkt.length>500000||!values.json||values.json.length>500000)throw Error('Bounded WKT and JSON attributes are required');
    return requestNativeQgis(config,{command,layer:values.layer,wkt:values.wkt,json:values.json},{signal});
  }
  if(command==='set-attribute'||command==='set-geometry'||command==='delete-feature'){
    const fid=values.fid;
    if(!/^-?(0|[1-9]\d*)$/.test(fid)||BigInt(fid)<-9223372036854775808n||BigInt(fid)>9223372036854775807n)
      throw Error('A signed QGIS feature ID is required');
    if(command==='delete-feature')return requestNativeQgis(config,{command,layer:values.layer,fid},{signal});
    if(command==='set-geometry'){
      if(values.wkt.length>500000)throw Error('A bounded WKT geometry is required');
      return requestNativeQgis(config,{command,layer:values.layer,fid,wkt:values.wkt},{signal});
    }
    if(!values.json||values.json.length>500000)throw Error('A bounded JSON value is required');
    return requestNativeQgis(config,{command,layer:values.layer,fid,field:values.field,json:values.json},{signal});
  }
  if(command==='open'){
    const path=realpathSync(rest[0]);if(!statSync(path).isFile())throw Error('QGIS input must be a regular file');
    return requestNativeQgis(config,{command:'open',path},{signal});
  }
  return exportNativeQgis(config,{layerId:values.layer,output:values.output},{signal});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(stringifyJson(await runNativeBridge(process.argv.slice(2))));}
  catch(error){console.error('qgis-native: '+error.message);process.exitCode=1;}
}
