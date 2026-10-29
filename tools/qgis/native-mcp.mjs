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
  server.registerTool('qgis_native_open',{description:'Open an existing vector file in native QGIS.',inputSchema:z.strictObject({input:path})},
    async({input},extra)=>respond([...options,'open',input],extra.signal));
  server.registerTool('qgis_native_export',{description:'Export a layer as normalized EPSG:4326 GeoJSON without overwriting an existing file.',
    inputSchema:z.strictObject({layer:path,output:path})},async({layer,output},extra)=>respond([...options,'export','--layer',layer,'--output',output],extra.signal));
  server.registerTool('qgis_native_normalize',{description:'Normalize an existing geographic QGIS GeoJSON export into a new file.',
    inputSchema:z.strictObject({input:path,output:path})},async({input,output},extra)=>respond(['normalize',input,'--output',output],extra.signal));
  return server;
}
serveStdio(createServer);
