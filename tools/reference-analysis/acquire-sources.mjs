#!/usr/bin/env node
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquire } from '../../plugins/pando-map-tools/lib/map-source.mjs';
import { reportArgument } from '../report-paths.mjs';

const workspace=resolve(fileURLToPath(new URL('../../',import.meta.url)));
async function prospectiveRealpath(path) {
  try { return await realpath(path); } catch (error) {
    if(error.code!=='ENOENT') throw error;
    const parent=dirname(path); if(parent===path) throw error;
    return resolve(await prospectiveRealpath(parent),relative(parent,path));
  }
}
async function main() {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2) {
    const key=args[i]; if(!['--catalog','--output'].includes(key)||!args[i+1]||args[i+1].startsWith('--')||options[key]) throw Error('Usage: acquire-sources.mjs [--catalog <catalog.json>] --output <external-directory>');
    options[key]=args[i+1];
  }
  if(!options['--output']) throw Error('--output is required');
  const catalog=reportArgument(options['--catalog'] ?? fileURLToPath(new URL('./source-catalog.json',import.meta.url)),{access:'read'});
  const output=await prospectiveRealpath(resolve(reportArgument(options['--output'],{access:'write'})));
  const rel=relative(await realpath(workspace),output);
  if(!rel || (!rel.startsWith('..'+(process.platform==='win32'?'\\':'/')) && rel!=='..' && !isAbsolute(rel))) throw Error('Original materials must be stored outside the application worktree');
  const data=JSON.parse(await readFile(catalog,'utf8'));
  if(data.schemaVersion!==1 || !Array.isArray(data.sources)) throw Error('Current source catalog required');
  const controller=new AbortController(), abort=()=>controller.abort(new Error('Map source acquisition cancelled'));
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try { for(const entry of data.sources) console.log(JSON.stringify(await acquire(entry,output,{signal:controller.signal}))); }
  finally { process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
