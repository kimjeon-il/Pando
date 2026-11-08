import {createHash} from 'node:crypto';
import {decodeLibraryArchiveBytes} from './library-archive.mjs';
import {decodeTerritorialSource} from './territorial-source-codec.mjs';

export const territorialCountryPrefix='assets/data/territorial-entities/source/countries/';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=path=>typeof path==='string'&&/^[-A-Za-z0-9_./]+$/.test(path)
  &&!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='.'||part==='..');

/** Metadata projection of the editable source archive, without payload reads. */
export function territorialSourceIndex(archive){
  if(archive?.schemaVersion!==1||!archive.files||Array.isArray(archive.files))throw Error('Invalid territorial source archive');
  const entities={},sources={};
  for(const [path,entry]of Object.entries(archive.files).sort(([a],[b])=>a<b?-1:a>b?1:0)){
    if(!path.startsWith(territorialCountryPrefix))continue;
    const match=/^([a-z][a-z0-9_]*)-([A-Za-z0-9_-]+)\.json$/.exec(path.slice(territorialCountryPrefix.length));
    if(!match||!safe(path)||!safe(entry.stored)||!['identity','gzip'].includes(entry.encoding)
      ||!Number.isSafeInteger(entry.bytes)||entry.bytes<0||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('Invalid territorial source entry: '+path);
    const id=match[1]+':'+match[2];
    if(Object.hasOwn(entities,id))throw Error('Duplicate territorial source: '+id);
    entities[id]=entry.sha256;sources[id]={path,...entry};
  }
  const resources=Object.fromEntries(Object.entries(archive.files).filter(([path])=>path.startsWith('assets/data/territorial-entities/source/geometries/')));
  return {schemaVersion:1,entities,sources,resources};
}

export function readTerritorialArchiveDescriptor(index,entityId,readStored){
  const entry=index.sources[entityId];if(!entry)throw Error('Missing territorial source: '+entityId);
  const stored=readStored(entry.stored),bytes=decodeLibraryArchiveBytes(stored,entry);
  if(JSON.parse(bytes).entityId!==entityId)throw Error('Territorial source filename identity mismatch: '+entityId);
  return {bytes,resource:{url:entry.stored,encoding:entry.encoding,compressedBytes:stored.length,
    decodedBytes:bytes.length,sha256:hash(stored)}};
}

export function readTerritorialArchiveEntity(index,entityId,readStored){
  const source=readTerritorialArchiveDescriptor(index,entityId,readStored),geometryPayloads=new Map();
  decodeTerritorialSource(JSON.parse(source.bytes),file=>{
    if(!geometryPayloads.has(file)){
      const entry=index.resources?.['assets/data/territorial-entities/source/'+file];
      if(!entry||!safe(entry.stored))throw Error('Missing territorial geometry archive resource: '+file);
      const stored=readStored(entry.stored),bytes=decodeLibraryArchiveBytes(stored,entry);
      geometryPayloads.set(file,{bytes,resource:{url:entry.stored,encoding:entry.encoding,compressedBytes:stored.length,
        decodedBytes:bytes.length,sha256:hash(stored)}});
    }
    return geometryPayloads.get(file).bytes;
  });
  return {...source,geometryPayloads};
}
