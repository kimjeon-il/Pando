import {createHash} from 'node:crypto';
import {isDeepStrictEqual as equal} from 'node:util';
import {gzipSync} from 'node:zlib';
import {archiveStoredPaths,decodeLibraryArchiveBytes,planSourceGeometryArchive} from './library-archive.mjs';
import {libraryStoragePath} from './library-storage-paths.mjs';
import {decodeTerritorialSource} from './territorial-source-codec.mjs';
import {assertOriginalAuthoringSourceStorageChanges,assertTerritorialSourceResourceBytes} from './territorial-original-authoring.mjs';
import {assertHistoricalSourceStorageChanges} from '../gis/historical-display-review.mjs';
import {assertRetainedCoast,retainedCoastMethod} from '../gis/retained-coast-source-review.mjs';

const base='assets/data/territorial-entities/source/';
const descriptorPattern=/^assets\/data\/territorial-entities\/source\/countries\/state-([A-Z][A-Z0-9]{2})\.json$/;
const resourcePattern=/^assets\/data\/territorial-entities\/source\/geometries\/sha256-[a-f0-9]{64}\.json$/;
const proofPattern=/^reports\/borders\/validation\/modern-raw-source-\d{8}\/(?:[A-Za-z0-9][\w.-]*\/)*[A-Za-z0-9][\w.-]*\.json$/;
const rawBranch='work/gis-raw-modern';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const reject=reason=>{throw Error('Raw coast storage: '+reason);};

function fileMap(input,test,label) {
  if(!(input instanceof Map)||!input.size)reject('explicit '+label+' file map required');
  const result=new Map(),seen=new Set();
  for(const [path,bytes] of input){
    if(typeof path!=='string'||!test(path)||seen.has(path.toLowerCase())||!Buffer.isBuffer(bytes)||!bytes.length)reject('invalid or duplicate '+label+' file: '+path);
    seen.add(path.toLowerCase());result.set(path,Buffer.from(bytes));
  }
  return result;
}

function archiveReader(index,readStored){
  return path=>{
    const entry=Object.hasOwn(index.files,path)&&index.files[path];
    if(!entry)reject('missing pinned archive entry: '+path);
    const stored=readStored(entry.stored);
    return decodeLibraryArchiveBytes(stored,entry,{readStored});
  };
}

function pack(path,bytes,direct){
  const sha=sha256(bytes),size=bytes.length,gzip=direct?bytes:gzipSync(bytes,{level:9});
  const chunked=!direct&&planSourceGeometryArchive(path,gzip,{sha256:sha,bytes:size});
  if(chunked)return chunked;
  const encoding=direct||gzip.length>=size?'identity':'gzip';
  const stored=libraryStoragePath(path,{sha256:sha,encoding,direct});
  return {entry:{stored,encoding,sha256:sha,bytes:size},outputs:new Map([[stored,encoding==='identity'?bytes:gzip]])};
}

/** Plan only retained-coordinate, current coast editions of existing sources.
 * readStored must read the frozen Git commit tree, never a working directory;
 * it returns null/undefined exclusively for an absent tree path. */
export function planRawCoastStore({index,readStored,sourceRevision,updates,proofs}={}){
  if(index?.schemaVersion!==1||index.branch!==rawBranch||index.reportLayout!=='subjects-v1'||!index.files||Array.isArray(index.files)
    ||typeof readStored!=='function'||typeof sourceRevision!=='string'||!/^[a-f0-9]{40}$/.test(sourceRevision))reject('raw revision with canonical archive layout required');
  const input=fileMap(updates,p=>descriptorPattern.test(p)||resourcePattern.test(p),'source');
  const reports=fileMap(proofs,p=>proofPattern.test(p),'evidence');
  const frozen=archiveReader(index,readStored),cached=new Map(),readPinned=path=>{
    if(!cached.has(path))cached.set(path,frozen(path));
    return cached.get(path);
  };
  const pairs=[],usedReports=new Set(),requiredPaths=new Set(),descriptors=[...input.keys()].filter(p=>descriptorPattern.test(p));
  if(!descriptors.length||descriptors.length>5)reject('one to five existing country descriptors required');
  const reportPaths=new Set(Object.keys(index.files).filter(p=>p.startsWith('reports/')).map(p=>p.toLowerCase()));
  for(const path of reports.keys()){
    if(reportPaths.has(path.toLowerCase())||readStored(path)!=null)reject('cannot replace existing evidence: '+path);
  }
  const readEvidence=path=>{
    if(reports.has(path)){usedReports.add(path);return reports.get(path);}
    return readPinned(path);
  };

  for(const [path,bytes] of input){
    if(resourcePattern.test(path)){
      assertTerritorialSourceResourceBytes(path,bytes);
      // A coordinate CAS may already be present, but its content cannot change.
      if(Object.hasOwn(index.files,path)&&!readPinned(path).equals(bytes))reject('cannot replace an existing coordinate resource: '+path);
    }
  }
  for(const path of descriptors){
    const expectedId='state:'+descriptorPattern.exec(path)[1],original=JSON.parse(readPinned(path)),changed=JSON.parse(input.get(path));
    if(original.entityId!==expectedId||changed.entityId!==expectedId)reject('source filename identity mismatch: '+path);
    const previous=decodeTerritorialSource(original,p=>readPinned(base+p));
    const next=decodeTerritorialSource(changed,p=>input.get(base+p)??readPinned(base+p));
    const selected=next.geometryVersions.filter(v=>v.validTo===null&&v.modernBoundarySupplement?.adoptionMode===retainedCoastMethod);
    if(selected.length!==1)reject('one explicit retained-current geometry required: '+path);
    const v=selected[0],before=previous.geometryVersions.find(x=>x.versionId===v.versionId);
    if(!before||equal(before.geometry,v.geometry))reject('unchanged or unknown coordinate version: '+path);
    const resource=base+changed.geometryVersions.find(x=>x.versionId===v.versionId).geometryResource.file;
    requiredPaths.add(path);requiredPaths.add(resource);pairs.push({next,previous});
  }
  if(requiredPaths.size!==input.size||[...requiredPaths].some(p=>!input.has(p)))reject('exact selected descriptor and coordinate resource files required');

  for(const {next,previous} of pairs){
    const options={prefixes:[...requiredPaths],readEvidence};
    assertOriginalAuthoringSourceStorageChanges(next,previous,options);
    if(assertHistoricalSourceStorageChanges(next,previous,options)!==1)reject('historical source admission did not admit the changed geometry');
    // Ensure an earlier historical dispatcher handler cannot substitute for
    // this dedicated retained-coast proof when an entity has other markers.
    if(assertRetainedCoast(next,previous,options)!==1)reject('retained-coast admission did not admit the changed geometry');
  }
  if(usedReports.size!==reports.size)reject('new evidence must be used by the admitted review');

  const nextIndex={...index,sourceRevision,files:{...index.files}},paths=new Map();
  const put=(path,bytes)=>{
    const selected=paths.get(path),pinned=readStored(path);
    if(selected&&!selected.equals(bytes)||pinned!=null&&(!Buffer.isBuffer(pinned)||!pinned.equals(bytes)))reject('immutable archive output collision: '+path);
    if(pinned==null)paths.set(path,bytes);
  };
  for(const [path,bytes] of [...input,...reports]){
    if(Object.hasOwn(index.files,path)&&index.files[path].sha256===sha256(bytes))continue;
    const {entry,outputs}=pack(path,bytes,reports.has(path));
    for(const [stored,output] of outputs)put(stored,output);
    nextIndex.files[path]=entry;
  }
  const indexBytes=Buffer.from(JSON.stringify(nextIndex)+'\n');
  paths.set('archive/index.json',indexBytes);
  const logical=new Map([...input,...reports]);
  // The helper compares all staged Git blobs; this additionally decodes the
  // current indexed logical payloads, including any reused/chunked resources.
  const verify=readResult=>{
    if(typeof readResult!=='function')reject('committed Git archive reader required');
    const storedIndex=readResult('archive/index.json');
    if(!Buffer.isBuffer(storedIndex)||!storedIndex.equals(indexBytes))reject('committed archive index differs from plan');
    const result=JSON.parse(storedIndex),read=archiveReader(result,readResult);
    for(const [path,bytes] of logical)if(!read(path).equals(bytes))reject('committed logical bytes differ: '+path);
    for(const path of descriptors)decodeTerritorialSource(JSON.parse(read(path)),p=>read(base+p));
    return true;
  };
  return {paths,verify};
}
