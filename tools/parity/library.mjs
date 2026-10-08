import {createTerritorialEntityLoader} from '../../assets/js/modules/territorial-entity-loader.js';
import {createTerritorialLibraryService} from '../../assets/js/modules/territorial-library-service.js';
import {selectGeometryVersion} from '../../assets/js/modules/territorial-library.js';

export async function libraryTrace(corpus,indexBytes) {
  let entityReads=0;
  const loader=createTerritorialEntityLoader({indexUrl:'https://fixture.invalid/index.json',indexSpec:corpus.index,
    dataRevision:corpus.index.sha256,cacheStorage:null,
    fetchFn:async url=>{
      if(new URL(url).pathname!=='/index.json'){entityReads++;throw new Error('Metadata queries must not fetch geometry');}
      return new Response(indexBytes);
    }});
  const service=createTerritorialLibraryService({loader,today:()=> '2026-10-08'});
  await service.load();
  return corpus.cases.map(row=>{
    if(row.op==='version')return {id:row.id,ids:[row.entityId],versions:[selectGeometryVersion(service.get(row.entityId),row.date)?.versionId??null],entityReads};
    const groups=service.search({query:row.query,referenceDate:row.date});
    const entities=groups.flatMap(group=>group.entities);
    return {id:row.id,ids:entities.map(entity=>entity.entityId),versions:entities.map(entity=>entity.selectedVersionId),entityReads};
  });
}

export async function libraryLoadingTrace(corpus,indexSpec,indexBytes,entityBytes) {
  let reads=0,fail=false;
  const loader=createTerritorialEntityLoader({indexUrl:'https://fixture.invalid/index.json',indexSpec,
    dataRevision:indexSpec.sha256,cacheStorage:null,fetchFn:async url=>{
      const request=new URL(url);
      if(request.origin!=='https://fixture.invalid'||request.searchParams.get('v')!==indexSpec.sha256)throw new Error('Unexpected catalog origin/revision');
      if(request.pathname==='/index.json')return new Response(indexBytes);
      if(request.pathname!=='/'+corpus.entityFile)throw new Error('Unexpected entity request path');
      reads++;if(fail)return new Response(null,{status:503});return new Response(entityBytes);
    }});
  await loader.loadIndex();
  const output=[];
  for(const row of corpus.operations){
    fail=row.fail;const before=reads;let value=null,ok=true;
    if(row.op==='load')try{value=await loader.loadEntity(corpus.entityId);}catch{ok=false;}
    else if(row.op!=='observe')throw new Error('Unknown loading operation');
    output.push({id:row.id,ok,readPerformed:row.op==='observe'?reads!==0:reads!==before,value});
  }
  return output;
}
