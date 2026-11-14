import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {withLibraryOutputs} from '../data/library-runtime.mjs';
import {readTerritorialSource,readTerritorialSourceDescriptors,territorialSourceRoot} from '../data/territorial-entity-sources.mjs';
import {visitCurrentWorldFeatures} from '../data/territorial-current-world.mjs';
import {streamCurrentWorldJson} from '../data/current-world-json-stream.mjs';

const output=fileURLToPath(new URL('../../assets/data/territorial-entities/generated/current-world.geojson',import.meta.url));
const view=JSON.parse(fs.readFileSync(path.join(territorialSourceRoot,'views/world.json'),'utf8'));
const knownIds=new Set(readTerritorialSourceDescriptors().map(entity=>entity.entityId));
const {bbox,...metadata}=view.sourceInfo.collectionMetadata;

function generate(fd=null) {
  const digest=createHash('sha256');
  let bytes=0, pending=[], pendingBytes=0;
  function flush() {
    if (!pending.length) return;
    const buffer=Buffer.from(pending.join(''),'utf8');
    digest.update(buffer);bytes+=buffer.length;
    if (fd!==null) {
      let written=0;
      while (written<buffer.length) {
        const count=fs.writeSync(fd,buffer,written,buffer.length-written);
        if (count<=0) throw new Error('Current world output: short write');
        written+=count;
      }
    }
    pending=[];pendingBytes=0;
  }
  const emit=part=>{
    pending.push(part);pendingBytes+=Buffer.byteLength(part);
    if (pendingBytes>=256*1024) flush();
  };
  const stats=streamCurrentWorldJson({metadata,bbox,visitFeatures:consumer=>{
    visitCurrentWorldFeatures({
      view, cloneGeometry:false,
      getEntity:id=>{
        if (!knownIds.has(id)) throw new Error('Missing current source descriptor: '+id);
        return readTerritorialSource(id);
      },
      visit:consumer,
    });
  }},emit);
  flush();
  if (stats.bytes!==bytes) throw new Error('Current world streamed byte count mismatch');
  return {...stats,sha256:digest.digest('hex'),descriptorCount:knownIds.size};
}

function onDisk() {
  if (!fs.existsSync(output)) throw new Error('Missing generated current world collection');
  const hash=createHash('sha256'),fd=fs.openSync(output,'r'),chunk=Buffer.allocUnsafe(256*1024);
  let size=0;
  try {
    while (true) {
      const count=fs.readSync(fd,chunk,0,chunk.length,null);
      if (!count) break;
      hash.update(chunk.subarray(0,count));size+=count;
    }
  } finally { fs.closeSync(fd); }
  return {bytes:size,sha256:hash.digest('hex')};
}

const check=process.argv.includes('--check');
const diagnose=process.argv.includes('--diagnose');
let stats;
if (check || diagnose) {
  stats=generate();
  if (check) {
    const stored=onDisk();
    if (stored.bytes!==stats.bytes || stored.sha256!==stats.sha256)
      throw new Error('Stale current world collection: '+JSON.stringify({expected:stats.sha256,stored:stored.sha256,expectedBytes:stats.bytes,storedBytes:stored.bytes}));
  }
} else {
  stats=withLibraryOutputs({paths:[output]},()=>{
    const temporary=output+'.'+process.pid+'.pending';
    let created=false,fd=null;
    try {
      fs.mkdirSync(path.dirname(output),{recursive:true});
      fd=fs.openSync(temporary,'wx');created=true;
      const result=generate(fd);
      fs.closeSync(fd);fd=null;
      fs.renameSync(temporary,output);created=false;
      return result;
    } finally {
      if(fd!==null)fs.closeSync(fd);
      if(created&&fs.existsSync(temporary))fs.unlinkSync(temporary);
    }
  });
}
console.log('CURRENT_WORLD_STREAM_DIAGNOSTICS '+JSON.stringify({mode:check?'check':diagnose?'diagnose':'generate',...stats}));
console.log('Derived world view: '+stats.featureCount+' explicitly selected country versions');
