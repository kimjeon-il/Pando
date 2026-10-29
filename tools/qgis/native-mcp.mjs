// Native MCP is deliberately separate from the existing upstream server until
// all used QGIS capabilities have native replacements.
import {McpServer} from '@modelcontextprotocol/server';
import {serveStdio} from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {runNativeBridge} from './native-bridge.mjs';

function createServer(){
  const server=new McpServer({name:'pando-qgis-native',version:'0.1.0'});
  const config=process.env.PANDO_QGIS_NATIVE_CONFIG;
  const options=config?['--config',config]:[];
  const respond=async(args,signal)=>({content:[{type:'text',text:JSON.stringify(await runNativeBridge(args,{signal}))}]});
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
  server.registerTool('qgis_native_select',{description:'Replace the selection using QGIS feature IDs as decimal strings or a QGIS expression.',
    inputSchema:z.strictObject({layer:path,fids:z.array(z.string().regex(/^-?(0|[1-9]\d*)$/)).max(10000).optional(),expression:z.string().min(1).max(10000).optional()})},
  async({layer,fids,expression},extra)=>respond([...options,'select','--layer',layer,...(fids===undefined?[]:['--fids',JSON.stringify(fids)]),
    ...(expression===undefined?[]:['--expression',expression])],extra.signal));
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
  server.registerTool('qgis_native_set_text_attribute',{description:'Change one text attribute within a bridge-owned QGIS edit session.',
    inputSchema:z.strictObject({layer:path,fid:z.string().regex(/^-?(0|[1-9]\d*)$/),field:path,value:z.string().max(65536)})},
  async({layer,fid,field,value},extra)=>respond([...options,'set-text-attribute',`--layer=${layer}`,`--fid=${fid}`,`--field=${field}`,`--value=${value}`],extra.signal));
  server.registerTool('qgis_native_set_geometry',{description:'Change one geometry using EPSG:4326 WKT within a bridge-owned QGIS edit session.',
    inputSchema:z.strictObject({layer:path,fid:z.string().regex(/^-?(0|[1-9]\d*)$/),wkt:z.string().min(1).max(500000)})},
  async({layer,fid,wkt},extra)=>respond([...options,'set-geometry',`--layer=${layer}`,`--fid=${fid}`,`--wkt=${wkt}`],extra.signal));
  server.registerTool('qgis_native_open',{description:'Open an existing vector file in native QGIS.',inputSchema:z.strictObject({input:path})},
    async({input},extra)=>respond([...options,'open',input],extra.signal));
  server.registerTool('qgis_native_export',{description:'Export a layer as normalized EPSG:4326 GeoJSON without overwriting an existing file.',
    inputSchema:z.strictObject({layer:path,output:path})},async({layer,output},extra)=>respond([...options,'export','--layer',layer,'--output',output],extra.signal));
  server.registerTool('qgis_native_normalize',{description:'Normalize an existing geographic QGIS GeoJSON export into a new file.',
    inputSchema:z.strictObject({input:path,output:path})},async({input,output},extra)=>respond(['normalize',input,'--output',output],extra.signal));
  return server;
}
serveStdio(createServer);
