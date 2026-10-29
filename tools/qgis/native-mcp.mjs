// Native MCP is deliberately separate from the existing upstream server until
// all used QGIS capabilities have native replacements.
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {runNativeBridge} from './native-bridge.mjs';
import {stringifyJson} from './normalize.mjs';

function createServer(){
  const server=new McpServer({name:'pando-qgis-native',version:'0.1.0'});
  const config=process.env.PANDO_QGIS_NATIVE_CONFIG;
  const options=config?['--config',config]:[];
  const respond=async(args,signal)=>({content:[{type:'text',text:stringifyJson(await runNativeBridge(args,{signal}))}]});
  const empty=z.strictObject({}),path=z.string().min(1);
  server.registerTool('qgis_native_start',{description:'Start or reuse the authenticated native QGIS instance.',inputSchema:empty},
    async(_args,extra)=>respond([...options,'start'],extra.signal));
  server.registerTool('qgis_native_status',{description:'Inspect the authenticated native QGIS instance.',inputSchema:empty},
    async(_args,extra)=>respond([...options,'status'],extra.signal));
  server.registerTool('qgis_native_project',{description:'Inspect the current QGIS project and its first ten layers.',inputSchema:empty},
    async(_args,extra)=>respond([...options,'project'],extra.signal));
  server.registerTool('qgis_native_layers',{description:'List QGIS layers with bounded pagination.',
    inputSchema:z.strictObject({offset:z.number().int().min(0).max(100000000).default(0),limit:z.number().int().min(1).max(100).default(50)})},
  async({offset,limit},extra)=>respond([...options,'layers','--offset',String(offset),'--limit',String(limit)],extra.signal));
  server.registerTool('qgis_native_schema',{description:'Inspect vector layer geometry, CRS and field definitions.',inputSchema:z.strictObject({layer:path})},
    async({layer},extra)=>respond([...options,'schema','--layer',layer],extra.signal));
  server.registerTool('qgis_native_set_visibility',{description:'Set the checked visibility of a QGIS layer without changing parent groups.',inputSchema:z.strictObject({layer:path,visible:z.boolean()})},
    async({layer,visible},extra)=>respond([...options,'set-visibility',`--layer=${layer}`,`--visible=${visible}`],extra.signal));
  server.registerTool('qgis_native_algorithms',{description:'List a bounded page of registered QGIS processing algorithms.',
    inputSchema:z.strictObject({offset:z.number().int().min(0).max(100000000).default(0),limit:z.number().int().min(1).max(100).default(50),search:z.string().min(1).max(256).optional()})},
    async({offset,limit,search},extra)=>respond([...options,'algorithms','--offset',String(offset),'--limit',String(limit),...(search===undefined?[]:[`--search=${search}`])],extra.signal));
  server.registerTool('qgis_native_buffer',{description:'Buffer a vector layer in its CRS units and export a new EPSG:4326 GeoJSON file.',
    inputSchema:z.strictObject({layer:path,output:path,distance:z.number().finite(),segments:z.number().int().min(1).max(100).default(5)})},
    async({layer,output,distance,segments},extra)=>respond([...options,'buffer',`--layer=${layer}`,`--output=${output}`,`--distance=${distance}`,'--segments',String(segments)],extra.signal));
  server.registerTool('qgis_native_features',{description:'Read a bounded page of vector features and exact attribute values.',
    inputSchema:z.strictObject({layer:path,offset:z.number().int().min(0).max(100000000).default(0),limit:z.number().int().min(1).max(100).default(10),
      expression:z.string().min(1).max(10000).optional(),geometry:z.boolean().default(false)})},
  async({layer,offset,limit,expression,geometry},extra)=>respond([...options,'features',`--layer=${layer}`,'--offset',String(offset),'--limit',String(limit),
    ...(expression===undefined?[]:[`--expression=${expression}`]),...(geometry?['--geometry']:[])],extra.signal));
  server.registerTool('qgis_native_select',{description:'Replace the selection using QGIS feature IDs as decimal strings or a QGIS expression.',
    inputSchema:z.strictObject({layer:path,fids:z.array(z.string().regex(/^-?(0|[1-9]\d*)$/)).max(10000).optional(),expression:z.string().min(1).max(10000).optional()})},
  async({layer,fids,expression},extra)=>respond([...options,'select','--layer',layer,...(fids===undefined?[]:['--fids',JSON.stringify(fids)]),
    ...(expression===undefined?[]:[`--expression=${expression}`])],extra.signal));
  server.registerTool('qgis_native_selection',{description:'Read selected QGIS feature IDs as decimal strings.',inputSchema:z.strictObject({layer:path})},
    async({layer},extra)=>respond([...options,'selection','--layer',layer],extra.signal));
  server.registerTool('qgis_native_clear_selection',{description:'Clear the selection of a vector layer.',inputSchema:z.strictObject({layer:path})},
    async({layer},extra)=>respond([...options,'clear-selection','--layer',layer],extra.signal));
  for(const [name,command,description] of [
    ['qgis_native_begin_edit','begin-edit','Start a new edit session without taking over existing edits.'],
    ['qgis_native_commit_edit','commit-edit','Commit an edit session started by this bridge.'],
    ['qgis_native_rollback_edit','rollback-edit','Discard an edit session started by this bridge.'],
    ['qgis_native_undo_edit','undo-edit','Undo the latest change in a bridge-owned edit session.'],
    ['qgis_native_redo_edit','redo-edit','Redo a change in a bridge-owned edit session.'],
  ])server.registerTool(name,{description,inputSchema:z.strictObject({layer:path})},
    async({layer},extra)=>respond([...options,command,'--layer',layer],extra.signal));
  server.registerTool('qgis_native_set_attribute',{description:'Change one QGIS attribute using its exact JSON text within a bridge-owned edit session.',
    inputSchema:z.strictObject({layer:path,fid:z.string().regex(/^-?(0|[1-9]\d*)$/),field:path,json:z.string().min(1).max(500000)})},
  async({layer,fid,field,json},extra)=>respond([...options,'set-attribute',`--layer=${layer}`,`--fid=${fid}`,`--field=${field}`,`--json=${json}`],extra.signal));
  server.registerTool('qgis_native_set_geometry',{description:'Change one geometry using EPSG:4326 WKT within a bridge-owned QGIS edit session.',
    inputSchema:z.strictObject({layer:path,fid:z.string().regex(/^-?(0|[1-9]\d*)$/),wkt:z.string().min(1).max(500000)})},
  async({layer,fid,wkt},extra)=>respond([...options,'set-geometry',`--layer=${layer}`,`--fid=${fid}`,`--wkt=${wkt}`],extra.signal));
  server.registerTool('qgis_native_delete_feature',{description:'Delete one feature within a bridge-owned edit session, with QGIS undo and rollback.',
    inputSchema:z.strictObject({layer:path,fid:z.string().regex(/^-?(0|[1-9]\d*)$/)})},
  async({layer,fid},extra)=>respond([...options,'delete-feature',`--layer=${layer}`,`--fid=${fid}`],extra.signal));
  server.registerTool('qgis_native_add_feature',{description:'Add one EPSG:4326 feature and exact JSON attributes within a bridge-owned edit session.',
    inputSchema:z.strictObject({layer:path,wkt:z.string().min(1).max(500000),json:z.string().min(1).max(500000)})},
  async({layer,wkt,json},extra)=>respond([...options,'add-feature',`--layer=${layer}`,`--wkt=${wkt}`,`--json=${json}`],extra.signal));
  server.registerTool('qgis_native_open',{description:'Open an existing vector file in native QGIS.',inputSchema:z.strictObject({input:path})},
    async({input},extra)=>respond([...options,'open',input],extra.signal));
  server.registerTool('qgis_native_open_raster',{description:'Open an existing raster file in native QGIS.',inputSchema:z.strictObject({input:path})},
    async({input},extra)=>respond([...options,'open-raster',input],extra.signal));
  server.registerTool('qgis_native_raster_info',{description:'Inspect raster dimensions, bands, CRS and extent.',inputSchema:z.strictObject({layer:path})},
    async({layer},extra)=>respond([...options,'raster-info',`--layer=${layer}`],extra.signal));
  server.registerTool('qgis_native_export',{description:'Export a layer as normalized EPSG:4326 GeoJSON without overwriting an existing file.',
    inputSchema:z.strictObject({layer:path,output:path})},async({layer,output},extra)=>respond([...options,'export','--layer',layer,'--output',output],extra.signal));
  server.registerTool('qgis_native_normalize',{description:'Normalize an existing geographic QGIS GeoJSON export into a new file.',
    inputSchema:z.strictObject({input:path,output:path})},async({input,output},extra)=>respond(['normalize',input,'--output',output],extra.signal));
  return server;
}
serveStdio(createServer);
