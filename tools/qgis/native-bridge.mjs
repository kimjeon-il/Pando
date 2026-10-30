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
const usage='Usage: node tools/qgis/native-bridge.mjs [--config FILE] start | status | project | active-layer [--layer ID] | transform --source-crs CRS --target-crs CRS --points JSON | layers [--offset N --limit N] | algorithms [--offset N --limit N --search TEXT] | buffer --layer ID --distance NUMBER [--segments N] --output NEW_OUTPUT | clip --layer ID --overlay ID --output NEW_OUTPUT | schema --layer ID | raster-info --layer ID | raster-sample --layer ID --x X --y Y [--band N] | set-visibility --layer ID --visible true|false | remove-layer --layer ID | features --layer ID [--offset N --limit N --expression TEXT --geometry] | select --layer ID (--fids JSON | --expression TEXT) | selection --layer ID | clear-selection --layer ID | begin-edit|commit-edit|rollback-edit|undo-edit|redo-edit --layer ID | add-field --layer ID --field FIELD --field-type TYPE | delete-field --layer ID --field FIELD | rename-field --layer ID --field FIELD --new-field FIELD | set-attribute --layer ID --fid FID --field FIELD --json JSON | set-geometry --layer ID --fid FID --wkt WKT | delete-feature --layer ID --fid FID | add-feature --layer ID --wkt WKT --json ATTRIBUTES | open INPUT | open-raster INPUT | export --layer ID --output NEW_OUTPUT | normalize INPUT --output NEW_OUTPUT';
export async function runNativeBridge(args,{signal}={}){
  signal?.throwIfAborted();
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{config:{type:'string'},layer:{type:'string'},overlay:{type:'string'},output:{type:'string'},offset:{type:'string'},limit:{type:'string'},search:{type:'string'},distance:{type:'string'},segments:{type:'string'},x:{type:'string'},y:{type:'string'},band:{type:'string'},fids:{type:'string'},expression:{type:'string'},fid:{type:'string'},field:{type:'string'},'field-type':{type:'string'},'new-field':{type:'string'},'source-crs':{type:'string'},'target-crs':{type:'string'},points:{type:'string'},json:{type:'string'},wkt:{type:'string'},visible:{type:'string'},geometry:{type:'boolean'}}});
  const [command,...rest]=positionals;
  if(command==='normalize'){
    if(values.overlay!==undefined)throw Error(usage);
    if(rest.length!==1||!values.output||values.layer||values.config||values.offset!==undefined||values.limit!==undefined||values.search!==undefined||values.distance!==undefined||values.segments!==undefined||values.x!==undefined||values.y!==undefined||values.band!==undefined||values.fids!==undefined||values.expression!==undefined||values.fid!==undefined||values.field!==undefined||values['field-type']!==undefined||values['new-field']!==undefined||values['source-crs']!==undefined||values['target-crs']!==undefined||values.points!==undefined||values.json!==undefined||values.wkt!==undefined||values.visible!==undefined||values.geometry!==undefined)throw Error(usage);
    return normalizeFile(rest[0],values.output);
  }
  if(!['start','status','project','layers','active-layer','transform','schema','raster-info','raster-sample','set-visibility','remove-layer','algorithms','buffer','clip','features','select','selection','clear-selection','begin-edit','commit-edit','rollback-edit','undo-edit','redo-edit','set-attribute','set-geometry','add-field','delete-field','rename-field','delete-feature','add-feature','open','open-raster','export'].includes(command))throw Error(usage);
  if((['start','status','project','layers','algorithms'].includes(command)&&(rest.length||values.layer||values.output))||
    (['open','open-raster'].includes(command)&&(rest.length!==1||values.layer||values.output))||
    (command==='active-layer'&&(rest.length||values.output||values.layer===''))||
    (command==='transform'&&(rest.length||values.output||values.layer||!values['source-crs']||!values['target-crs']||!values.points))||
    (command!=='transform'&&(values['source-crs']!==undefined||values['target-crs']!==undefined||values.points!==undefined))||
    (['schema','raster-info','raster-sample','set-visibility','remove-layer'].includes(command)&&(rest.length||!values.layer||values.output))||
    (command==='raster-sample'&&(values.x===undefined||values.y===undefined))||
    (command!=='raster-sample'&&(values.x!==undefined||values.y!==undefined||values.band!==undefined))||
    (command==='set-visibility'&&!['true','false'].includes(values.visible))||
    (command!=='set-visibility'&&values.visible!==undefined)||
    (['features','select','selection','clear-selection','begin-edit','commit-edit','rollback-edit','undo-edit','redo-edit','set-attribute','set-geometry','add-field','delete-field','rename-field','delete-feature','add-feature'].includes(command)&&(rest.length||!values.layer||values.output))||
    (command==='set-attribute'&&(!values.fid||!values.field||values.json===undefined))||
    (command==='set-geometry'&&(!values.fid||!values.wkt))||
    (command==='delete-feature'&&!values.fid)||
    (command==='add-feature'&&(!values.wkt||values.json===undefined))||
    (!['set-attribute','set-geometry','delete-feature'].includes(command)&&values.fid!==undefined)||
    (['add-field','delete-field','rename-field'].includes(command)&&!values.field)||
    (command==='rename-field'&&!values['new-field'])||
    (command!=='rename-field'&&values['new-field']!==undefined)||
    (command==='add-field'&&!['string','integer','int64','double','boolean'].includes(values['field-type']))||
    (command!=='add-field'&&values['field-type']!==undefined)||
    (!['set-attribute','add-field','delete-field','rename-field'].includes(command)&&values.field!==undefined)||
    (!['set-attribute','add-feature'].includes(command)&&values.json!==undefined)||
    (!['set-geometry','add-feature'].includes(command)&&values.wkt!==undefined)||
    (command==='select'&&((values.fids===undefined)===(values.expression===undefined)))||
    (command!=='select'&&values.fids!==undefined)||
    (!['select','features'].includes(command)&&values.expression!==undefined)||
    (command!=='features'&&values.geometry!==undefined)||
    (['export','buffer','clip'].includes(command)&&(rest.length||!values.layer||!values.output))||
    (command==='clip'&&!values.overlay)||(command!=='clip'&&values.overlay!==undefined)||
    (command==='buffer'&&values.distance===undefined)||
    (command!=='buffer'&&(values.distance!==undefined||values.segments!==undefined))||
    (command!=='algorithms'&&values.search!==undefined)||
    (!['layers','features','algorithms'].includes(command)&&(values.offset!==undefined||values.limit!==undefined)))throw Error(usage);
  let offset=0,limit=50;
  if(command==='layers'||command==='features'||command==='algorithms'){
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
  if(command==='active-layer')return requestNativeQgis(config,{command,...(values.layer===undefined?{}:{layer:values.layer})},{signal});
  if(command==='transform'){
    const sourceCrs=values['source-crs'],targetCrs=values['target-crs'];
    if(!sourceCrs.trim()||sourceCrs.length>128||!targetCrs.trim()||targetCrs.length>128)throw Error('Two bounded explicit CRSs are required');
    let points;try{points=JSON.parse(values.points);}catch{throw Error('Coordinates must be a JSON array of XY pairs');}
    if(!Array.isArray(points)||points.length<1||points.length>10000||points.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>typeof value!=='number'||!Number.isFinite(value))))
      throw Error('Coordinates must contain 1 to 10000 finite XY pairs');
    return requestNativeQgis(config,{command,sourceCrs,targetCrs,points},{signal});
  }
  if(command==='algorithms'){
    if(values.search!==undefined&&(!values.search.trim()||values.search.length>256))throw Error('A bounded nonempty algorithm search is required');
    return requestNativeQgis(config,{command,offset,limit,...(values.search===undefined?{}:{search:values.search})},{signal});
  }
  if(command==='schema')return requestNativeQgis(config,{command:'schema',layer:values.layer},{signal});
  if(command==='raster-info')return requestNativeQgis(config,{command,layer:values.layer},{signal});
  if(command==='raster-sample'){
    const decimal=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    const x=Number(values.x),y=Number(values.y),band=values.band===undefined?1:Number(values.band);
    if(!decimal.test(values.x)||!decimal.test(values.y)||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isInteger(band)||band<1||band>10000||
      (values.band!==undefined&&!/^[1-9]\d*$/.test(values.band)))throw Error('Finite layer CRS coordinates and a valid band are required');
    return requestNativeQgis(config,{command,layer:values.layer,x,y,band},{signal});
  }
  if(command==='set-visibility')return requestNativeQgis(config,{command,layer:values.layer,visible:values.visible==='true'},{signal});
  if(command==='remove-layer')return requestNativeQgis(config,{command,layer:values.layer},{signal});
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
  if(command==='add-field'||command==='delete-field'||command==='rename-field'){
    if(!values.field.trim()||values.field.length>128)throw Error('A bounded field name is required');
    if(command==='rename-field'&&(!values['new-field'].trim()||values['new-field'].length>128))throw Error('A bounded new field name is required');
    return requestNativeQgis(config,{command,layer:values.layer,field:values.field,...(command==='add-field'?{fieldType:values['field-type']}:{}) ,...(command==='rename-field'?{newField:values['new-field']}:{})},{signal});
  }
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
  if(command==='open'||command==='open-raster'){
    const path=realpathSync(rest[0]);if(!statSync(path).isFile())throw Error('QGIS input must be a regular file');
    return requestNativeQgis(config,{command,path},{signal});
  }
  if(command==='buffer'){
    const distance=Number(values.distance),segments=values.segments===undefined?5:Number(values.segments);
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(values.distance)||!Number.isFinite(distance)||!Number.isInteger(segments)||segments<1||segments>100||
      (values.segments!==undefined&&!/^[1-9]\d*$/.test(values.segments)))throw Error('A finite buffer distance and 1–100 segments are required');
    return exportNativeQgis(config,{layerId:values.layer,output:values.output,buffer:{distance,segments}},{signal});
  }
  if(command==='clip')return exportNativeQgis(config,{layerId:values.layer,output:values.output,clip:{overlay:values.overlay}},{signal});
  return exportNativeQgis(config,{layerId:values.layer,output:values.output},{signal});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(stringifyJson(await runNativeBridge(process.argv.slice(2))));}
  catch(error){console.error('qgis-native: '+error.message);process.exitCode=1;}
}
