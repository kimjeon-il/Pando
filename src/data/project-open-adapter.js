// Source readers own format-specific decoding; the project domain receives
// one admission description regardless of whether bytes came from the
// built-in world catalog or an imported GeoPackage.
const OPEN_SOURCES=Object.freeze({
  builtin:Object.freeze({readPhase:'queued',admission:'core-source',reason:'builtin'}),
  project:Object.freeze({readPhase:'eager',admission:'document',reason:'load'}),
});
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function createProjectReader({source='project',read}={}){
  if(!Object.hasOwn(OPEN_SOURCES,source))throw new TypeError('Unknown project reader source.');
  if(typeof read!=='function')throw new TypeError('Project reader requires an asynchronous source function.');
  return Object.freeze({format:'pandolab-project-reader',source,read,
    readPhase:OPEN_SOURCES[source].readPhase});
}
export function normalizeProjectReader(input,{source=null}={}){
  if(source!==null&&!Object.hasOwn(OPEN_SOURCES,source))
    throw new TypeError('Unknown project source.');
  if(typeof input==='function')return createProjectReader({source:source||'project',read:input});
  if(!isRecord(input)||input.format!=='pandolab-project-reader'
    ||!Object.hasOwn(OPEN_SOURCES,input.source)||typeof input.read!=='function'
    ||input.readPhase!==OPEN_SOURCES[input.source].readPhase)
    throw new TypeError('A registered project reader is required.');
  if(source!==null&&source!==input.source)
    throw new TypeError('Project reader source conflicts with the requested source.');
  return input;
}
export function adaptProjectReadResult(reader,input){
  if(input==null)return null;
  if(!isRecord(input))throw new TypeError('A project reader must return a document or Core source.');
  const description=OPEN_SOURCES[reader.source];
  if(!description)throw new TypeError('Unknown project read result source.');
  if(reader.source==='builtin'&&!(Number.isSafeInteger(input.baselineId)&&input.baselineId>0)
    &&!(input.kind==='temporal-candidate'
      &&Number.isSafeInteger(input.candidateId)&&input.candidateId>0))
    throw new TypeError('Builtin project admission requires a prepared C++ source.');
  return Object.freeze({format:'pandolab-project-read-result',source:reader.source,
    admission:description.admission,reason:description.reason,payload:input});
}
export function projectOpenReceipt({readResult,accepted,document=null,generation=null,contentProject=null}={}){
  if(!readResult||readResult.format!=='pandolab-project-read-result')
    throw new TypeError('Project completion requires a normalized source result.');
  if(typeof accepted!=='boolean')throw new TypeError('Project completion requires an acceptance result.');
  if(accepted&&(!isRecord(document)||typeof document.documentId!=='string'||!document.documentId
    ||!Number.isSafeInteger(generation)||generation<1))
    throw new TypeError('Accepted project completion requires a C++ document and generation.');
  return Object.freeze({accepted,source:readResult.source,admission:readResult.admission,
    reason:readResult.reason,documentId:accepted?document.documentId:null,
    generation:accepted?generation:null,contentProject:accepted?contentProject:null});
}

export function projectOpenCancelledReceipt(reader){
  const description=OPEN_SOURCES[reader?.source];
  if(!description)throw new TypeError('Cancelled project opening requires a registered reader.');
  return Object.freeze({accepted:false,source:reader.source,admission:description.admission,
    reason:description.reason,documentId:null,generation:null,contentProject:null});
}
