/** Official GeoNames source inventory and evidence-gated city candidates.
 * fetch: primary cities500 then independent allCountries coverage audit.
 * build: only pinned ZIP snapshot/metadata; review: explicit human-sourced ID actions.
 * Modern population and feature codes NEVER decide historical city identity or rank.
 */
import {randomUUID} from 'node:crypto';
import {createWriteStream,existsSync,mkdirSync,readFileSync,renameSync,
  rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {downloadVerifiedRanges} from './download-terrain-source.mjs';
import {reportPath} from './report-paths.mjs';
import {verifyZip} from './lib/geonames-zip.mjs';
import {BASE_URL,LICENSE,POLICY,DETAIL_COUNTRIES,GENERATED_START,GENERATED_END,
  fileHash,parseRow,candidate,scanPrimary,scanSupplement,validateCandidates,
  summarize,auditKept,largest} from './lib/geonames-policy.mjs';
import {review} from './lib/geonames-review.mjs';
import {renderStatistics} from './lib/geonames-statistics.mjs';

export {BASE_URL,LICENSE,POLICY,parseRow,candidate,scanPrimary,scanSupplement,
  validateCandidates,summarize,auditKept,largest,review};
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CACHE=join(ROOT,'reports/places/.cache');
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
export function writeJson(path,contents){
  mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,JSON.stringify(contents,null,2)+'\n');
}
const attemptsURL=name=>BASE_URL+name+'.zip';
async function downloadBody(url,file,fetcher) {
  const result=await fetcher(url,{headers:{'User-Agent':'PandoLab-place-data-audit/1',
    'Accept-Encoding':'identity'},signal:AbortSignal.timeout(900000)});
  if(!result.ok||!result.body)throw Error('HTTP '+result.status);
  const expected=Number(result.headers.get('content-length')||0),
    updated=result.headers.get('last-modified'),etag=result.headers.get('etag');
  let count=0;
  const counter=new Transform({transform(chunk,encoding,callback){
    count+=chunk.length;
    if(count>4294967296)return callback(Error('Official ZIP exceeds approved maximum size'));
    callback(null,chunk);
  }});
  await pipeline(Readable.fromWeb(result.body),counter,createWriteStream(file,{flags:'wx'}));
  if(expected&&count!==expected)throw Error('short transfer '+count+' != '+expected);
  return {expected,total:count,lastModified:updated,etag,resolvedUrl:result.url};
}
async function inspectHead(url,fetcher){
  const res=await fetcher(url,{method:'HEAD',headers:{'Accept-Encoding':'identity'},
    signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw Error('HEAD HTTP '+res.status);
  const contentLength=res.headers.get('content-length');
  if(!contentLength||!Number.isSafeInteger(Number(contentLength))||Number(contentLength)<=0)
    throw Error('Missing verified Content-Length');
  return {size:Number(contentLength),lastModified:res.headers.get('last-modified'),
    etag:res.headers.get('etag'),resolvedUrl:res.url};
}
export async function fetchSource(name,cache,{fetcher=fetch,baseUrl=BASE_URL}={}){
  if(!['cities500','allCountries'].includes(name))throw Error('Unapproved GeoNames source '+name);
  mkdirSync(cache,{recursive:true});
  const target=join(cache,name+'.zip'),metadataPath=join(cache,name+'.source.json');
  if(existsSync(target)&&existsSync(metadataPath)){
    const meta=readJson(metadataPath),found=await fileHash(target);
    if(found!==meta.sha256)throw Error(target+': cached hash mismatch; refusing to reuse it');
    console.log(name+': using verified cache '+meta.sha256);
    return {source:name,status:'cached',failures:[]};
  }
  const url=baseUrl+name+'.zip',failures=[];
  for(let attempt=1;attempt<=2;attempt++){
    const partial=join(cache,'.'+name+'-'+randomUUID()+'.zip.part');
    try{
      const ranged=name==='allCountries'&&attempt===1;
      let info;
      if(ranged) {
        const head=await inspectHead(url,fetcher);
        const result=await downloadVerifiedRanges({url,output:partial,workers:6,chunkMiB:8,
          fetcher,quiet:true});
        const again=await inspectHead(url,fetcher);
        if(result.size!==head.size||again.size!==head.size||again.etag!==head.etag||
            again.lastModified!==head.lastModified)
          throw Error('source changed during ranged download');
        info={total:result.size,lastModified:head.lastModified,etag:head.etag,
          resolvedUrl:head.resolvedUrl};
      }else info=await downloadBody(url,partial,fetcher);
      const expected=name+'.txt',member=await verifyZip(partial,expected);
      if(existsSync(target)&&existsSync(metadataPath))
        throw Error('Concurrent verified source already exists: '+target);
      renameSync(partial,target);
      const metadata={url,resolvedUrl:info.resolvedUrl,
        downloadedAt:new Date().toISOString(),lastModified:info.lastModified,
        zipMemberTimestamp:member.timeISO,geonamesDerived:true,license:LICENSE,
        licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
        bytes:statSync(target).size,sha256:await fileHash(target),member:expected,
        downloadMethod:ranged?'verified-http-ranges':'http-stream'};
      writeJson(metadataPath,metadata);
      console.log(name+': completed '+metadata.bytes.toLocaleString('en-US')+' bytes');
      return {source:name,status:'downloaded',failures};
    }catch(error){
      failures.push({stage:'official-download',attempt,url,error:error.name+': '+error.message});
      console.error(name+': attempt '+attempt+' failed: '+error.message);
    }finally {rmSync(partial,{force:true});}
  }
  return {source:name,status:'failed',failures};
}
export async function fetchSources(cache=CACHE,options={}){
  const fetchOne=options.fetchSource||((name)=>fetchSource(name,cache,options));
  const primary=await fetchOne('cities500');
  writeJson(join(cache,'fetch-attempts.json'),[primary]);
  const secondary=await fetchOne('allCountries');
  const attempts=[primary,secondary];
  writeJson(join(cache,'fetch-attempts.json'),attempts);
  if(attempts.every(x=>x.status==='failed'))
    throw Error('Both official sources failed; see fetch-attempts.json before selecting a verified mirror');
  return attempts;
}
const countBy=(rows,key)=>{const map=new Map();for(const row of rows){
  const k=key(row);map.set(k,(map.get(k)||0)+1);
}return map;};
const patchedReport=(current,generated)=>{
  if(current.split(GENERATED_START).length!==2||current.split(GENERATED_END).length!==2)
    throw Error('Report requires exactly one generated statistics marker pair');
  const [start,rest]=current.split(GENERATED_START);
  return start+GENERATED_START+'\n\n'+generated+'\n'+GENERATED_END+rest.split(GENERATED_END)[1];
};
export async function build(cache=CACHE,statsPath=join(ROOT,'reports/places/geonames-statistics.json'),
  report=reportPath('reports/places/place-data-audit.md',{access:'write'})){
  const primaryName=existsSync(join(cache,'cities500.source.json'))?'cities500':'allCountries';
  const [rows,primary]=await scanPrimary(primaryName,cache);
  validateCandidates(rows);rows.sort((a,b)=>a.geonameId-b.geonameId);
  const sources={[primaryName]:readJson(join(cache,primaryName+'.source.json'))};
  let supplement=null;
  if(primaryName!=='allCountries'&&existsSync(join(cache,'allCountries.source.json'))){
    supplement=await scanSupplement(cache,rows);
    sources.allCountries=readJson(join(cache,'allCountries.source.json'));
  }
  const byCountry=new Map();
  for(const row of rows){
    if(!byCountry.has(row.countryCode))byCountry.set(row.countryCode,[]);
    byCountry.get(row.countryCode).push(row);
  }
  const sourceCountries=new Set([...Object.keys(primary.sourceCountryRows),
    ...Object.keys(supplement?.sourceCountryRows||{})]);
  const countryCounts=Object.fromEntries([...sourceCountries].sort().map(code=>
    [code,(byCountry.get(code)||[]).length]));
  const details={};
  for(const code of DETAIL_COUNTRIES){
    const country=byCountry.get(code)||[];
    const low=country.filter(row=>row.population<POLICY.populationMinimum)
      .sort((a,b)=>a.population-b.population||a.geonameId-b.geonameId);
    const samples=new Map([...low.slice(0,6),...low.slice(-6)].map(row=>[row.geonameId,row]));
    details[code]={...summarize(country),top30:largest(country,30),
      under50kAdminSamples:[...samples.values()]};
    if(code==='KR')details[code].allRows=country;
  }
  const attempts=join(cache,'fetch-attempts.json');
  const stats={policy:POLICY,primarySource:primaryName,sources,primary,
    totals:summarize(rows),countryCounts,countryDetails:details,
    audit:auditKept(rows),supplement,fetchAttempts:existsSync(attempts)?readJson(attempts):[]};
  const reportSource=readFileSync(report,'utf8');
  const reportContent=patchedReport(reportSource,renderStatistics(stats));
  const candidatePath=join(cache,'candidates.ndjson');
  mkdirSync(cache,{recursive:true});
  writeFileSync(candidatePath,rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':''));
  stats.candidateArtifact={path:'candidates.ndjson',rows:rows.length,
    sha256:await fileHash(candidatePath),bytes:statSync(candidatePath).size};
  writeJson(statsPath,stats);writeFileSync(report,reportContent);
  console.log(primaryName+': '+primary.rawRows.toLocaleString('en-US')+' -> '+
    rows.length.toLocaleString('en-US')+' candidates; '+candidatePath);
  return stats;
}
function argsOf(argv){
  const options={};
  for(let i=0;i<argv.length;i++){
    const flag=argv[i];
    if(!['--cache','--stats','--report','--reviews','--review-overrides'].includes(flag))
      throw Error('Unknown option '+flag);
    if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing option '+flag);
    options[flag.slice(2)]=argv[++i];
  }
  return options;
}
export async function main(argv=process.argv.slice(2)){
  const command=argv[0],options=argsOf(argv.slice(1));
  if(!['fetch','build','review'].includes(command))throw Error('Expected fetch, build or review');
  const cache=options.cache||CACHE;
  if(command==='fetch')return fetchSources(cache);
  if(command==='build')return build(cache,
    options.stats||join(ROOT,'reports/places/geonames-statistics.json'),
    options.report||reportPath('reports/places/place-data-audit.md',{access:'write'}));
  const reviews=options.reviews||join(ROOT,'reports/places/candidate-reviews.json');
  let overrides=options['review-overrides']||null;
  const defaultReviews=join(ROOT,'reports/places/candidate-reviews.json');
  const defaultOverride=join(ROOT,'reports/places/candidate-review-overrides.json');
  if(!overrides&&resolve(reviews)===resolve(defaultReviews)&&existsSync(defaultOverride))
    overrides=defaultOverride;
  return review(cache,reviews,
    options.stats||join(ROOT,'reports/places/candidate-review-summary.json'),
    options.report||reportPath('reports/places/place-candidate-review.md',{access:'write'}),overrides);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{console.error('place-candidates: '+error.message);process.exitCode=1;});
}
