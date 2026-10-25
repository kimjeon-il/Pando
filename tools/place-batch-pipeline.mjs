/** Source-verified, offline historical city batch queue and finalization. Never publishes runtime data. */
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,linkSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const PLACES=join(ROOT,'reports/places');
export const SCHEMA='pando-places-tier1-review-v6';
export const STAGING_STATUS='verified-source-staging-not-runtime';
const SLOTS=['nameKo','nameEn','nameNative'];
const DEFAULTS={nameKo:'defaultDisplayNameKo',nameEn:'defaultDisplayNameEn',
  nameNative:'defaultDisplayNameNative',nativeLanguage:'defaultNativeLanguage'};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const positive=x=>Number.isSafeInteger(x)&&x>0;
export const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
async function fileHash(path){const hash=createHash('sha256');for await(const part of createReadStream(path))hash.update(part);return hash.digest('hex');}

export function writeNewJson(path,value){
 const dest=resolve(path);mkdirSync(dirname(dest),{recursive:true});
 if(existsSync(dest))throw Error('Refusing to overwrite existing file: '+dest);
 const temp=join(dirname(dest),'.place-batch-'+randomUUID()+'.tmp');
 try{
   writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
   linkSync(temp,dest); // atomically create; never clobber an existing reviewed file
 }catch(error){if(error.code==='EEXIST')throw Error('Refusing to overwrite existing file: '+dest);throw error;}
 finally{rmSync(temp,{force:true});}
}
export function registered(places=PLACES){
 const files=readdirSync(places).filter(x=>/^tier1-major-cities-batch.*\.json$/u.test(x)).sort();
 const known=new Map();
 for(const name of files){
   const path=join(places,name),data=readJson(path);
   if(data?.schema!==SCHEMA||!Array.isArray(data.records))throw Error(path+': unsupported schema or missing records');
   for(const row of data.records){
     const id=object(row)?row.geonameId:null;
     if(!positive(id))throw Error(path+': invalid GeoNames ID '+id);
     if(known.has(id))throw Error('Duplicate GeoNames ID '+id+': '+known.get(id).path+' and '+path);
     known.set(id,{path,record:row});
   }
 }
 return {files,known};
}
export function audit(places=PLACES){
 const {files,known}=registered(places);
 let total=0,missing=0;
 for(const {record} of known.values())for(const period of record.displayTimeline||[]){
   total++;if(!period.sourceUrl)missing++;
 }
 return {batchFiles:files.length,cities:known.size,nameTimelineEntries:total,
   legacyTimelineEntriesWithoutSourceUrl:missing,
   scope:'staged historical name data, not runtime or historical city ranking'};
}
export function validCandidate(row,line){
 if(!object(row)||!positive(row.geonameId))throw Error('Candidate line '+line+': invalid GeoNames ID');
 if(row.featureClass!=='P')throw Error('Candidate line '+line+': not settlement feature class P');
 for(const [field,lo,hi] of [['latitude',-90,90],['longitude',-180,180]])
   if(typeof row[field]!=='number'||!Number.isFinite(row[field])||row[field]<lo||row[field]>hi)
     throw Error('Candidate line '+line+': invalid '+field);
 if(!Number.isSafeInteger(row.population)||row.population<0)throw Error('Candidate line '+line+': invalid population');
 if(typeof row.name!=='string'||!row.name.trim())throw Error('Candidate line '+line+': missing source name');
 if(typeof row.countryCode!=='string'||row.countryCode.length!==2)
   throw Error('Candidate line '+line+': invalid source country code');
}
export async function plan(candidates,places=PLACES,{batch,limit=25,countries=[],minPopulation=0,reviewedSummary=null}={}){
 if(!positive(batch)||!Number.isSafeInteger(limit)||limit<1||limit>500||
   !Number.isSafeInteger(minPopulation)||minPopulation<0)throw Error('Invalid batch, limit or minimum population');
 const {files,known}=registered(places);
 if(files.some(name=>new RegExp('batch0*'+batch+'(?:-|\\.)').test(name)))throw Error('Batch '+batch+' already exists');
 if(!existsSync(candidates))throw Error('Candidate cache not found: '+candidates+'; run build-place-candidates.py review first');
 const digest=await fileHash(candidates);
 if(reviewedSummary&&readJson(reviewedSummary)?.refinedArtifact?.sha256!==digest)
   throw Error('Candidate cache SHA-256 differs from the reviewed source summary');
 const chosen=new Set(countries),seen=new Set(),rows=[];
 const lines=createInterface({input:createReadStream(candidates,{encoding:'utf8'}),crlfDelay:Infinity});
 let n=0;
 for await(const raw of lines){
   n++;if(!raw.trim())continue;
   const row=JSON.parse(raw);validCandidate(row,n);
   if(seen.has(row.geonameId))throw Error('Duplicate candidate GeoNames ID '+row.geonameId+' at line '+n);
   seen.add(row.geonameId);
   if(known.has(row.geonameId)||row.population<minPopulation||(chosen.size&&!chosen.has(row.countryCode)))continue;
   rows.push(row);
 }
 rows.sort((a,b)=>Number(b.featureCode==='PPLC')-Number(a.featureCode==='PPLC')||
   b.population-a.population||a.geonameId-b.geonameId);
 const selected=rows.slice(0,limit);
 return {schema:'pando-places-research-queue-v1',batch,status:'unreviewed-candidates-not-city-approval',
   candidateFileSha256:digest,sources:'GeoNames refined candidate cache; present-day metadata only',
   filters:{countries:[...chosen].sort(),minimumPopulation:minPopulation,limit},
   counts:{previouslyStaged:known.size,eligibleUnstaged:rows.length,selected:selected.length},
   candidates:selected.map(row=>({geonameId:row.geonameId,sourceName:row.name,
     sourceCountryCode:row.countryCode,featureCode:row.featureCode,populationSource:row.population,
     latitude:row.latitude,longitude:row.longitude,difficulty:'unclassified',
     researchStatus:'needs-identity-and-historical-name-review',
     sourceUrl:'https://www.geonames.org/'+row.geonameId+'/'})),
   notes:['No city has been approved; GeoNames population and feature code do not set historical rank.',
     'Do not infer historical sovereignty, official language, founding date or spelling from modern country code.',
     'Assign A/B/C difficulty only after source-based historical review.']};
}
function requireText(value,field){if(typeof value!=='string'||!value.trim())throw Error('Missing '+field);}
function gregorian(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))throw Error('invalid Gregorian date');
 const [year,month,day]=value.split('-').map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
 const lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>lengths[month-1])throw Error('invalid Gregorian date');
 return year;
}
export function validateReviewed(data,known=new Map()){
 if(data?.schema!==SCHEMA||data.status!==STAGING_STATUS)
   throw Error('Expected verified-source staging schema/status; unreviewed queues cannot be finalized');
 if(!Array.isArray(data.records)||!data.records.length)throw Error('No researched city records');
 requireText(data.source,'batch source provenance');requireText(data.checkedOn,'checkedOn');
 gregorian(data.checkedOn);
 const used=new Set();let periodCount=0;
 for(const item of data.records){
   const id=item?.geonameId,context='City '+id;
   if(!positive(id)||used.has(id)||known.has(id))throw Error('Duplicate or invalid GeoNames ID '+id);
   used.add(id);
   if(item.featureClass!=='P')throw Error(context+': featureClass must be P');
   for(const [field,lo,hi] of [['latitude',-90,90],['longitude',-180,180]])
     if(typeof item[field]!=='number'||!Number.isFinite(item[field])||item[field]<lo||item[field]>hi)
       throw Error(context+': invalid '+field);
   if(!/^[A-Z]{2}$/u.test(item.sourceCountryCode||''))throw Error(context+': invalid sourceCountryCode');
   for(const field of [...Object.values(DEFAULTS),'shortDescriptionKo','sourceUrl'])
     requireText(item[field],context+'.'+field);
   if([...item.shortDescriptionKo].length>28)throw Error(context+': shortDescriptionKo exceeds 28 code points');
   if(!item.sourceUrl.startsWith('https://'))throw Error(context+': invalid source URL');
   if(!Array.isArray(item.names)||!item.names.length)throw Error(context+': empty names[]');
   const choices=new Set();
   for(const name of item.names){
     requireText(name?.language,context+' names.language');requireText(name?.text,context+' names.text');
     choices.add(name.language+'\0'+name.text);
   }
   const periods=item.displayTimeline;
   if(!Array.isArray(periods)||!periods.length)throw Error(context+': provide at least one sourced period');
   const last={};let previous=null;
   for(const [i,p] of periods.entries()){
     const yearOnly=Object.hasOwn(p,'fromYear'),hasDay=Object.hasOwn(p,'fromDate');
     if(yearOnly===hasDay)throw Error(context+' period '+i+': choose fromDate XOR fromYear');
     const year=yearOnly?p.fromYear:gregorian(p.fromDate);
     if(yearOnly&&(!positive(year)||year>9999))throw Error(context+' period '+i+': invalid fromYear');
     if(previous&&(year<previous.year||(year===previous.year&&
       (!previous.day||!hasDay||p.fromDate<=previous.day))))
       throw Error(context+' period '+i+': out of order or uncertain same-year transitions');
     previous={year,day:hasDay?p.fromDate:null};
     for(const field of ['kind','sourceUrl'])requireText(p[field],context+' period '+i+'.'+field);
     if(!p.sourceUrl.startsWith('https://'))throw Error(context+' period '+i+': sourceUrl must use HTTPS');
     const changed=SLOTS.filter(key=>Object.hasOwn(p,key));
     if(!changed.length)throw Error(context+' period '+i+': no changed name slots');
     for(const key of changed)requireText(p[key],context+' period '+i+'.'+key);
     if(Object.hasOwn(p,'nativeLanguage')){
       requireText(p.nativeLanguage,context+' period '+i+'.nativeLanguage');
       if(!Object.hasOwn(p,'nameNative'))throw Error(context+' period '+i+': nativeLanguage without nameNative');
     }
     if(Object.hasOwn(p,'nameNative')&&!Object.hasOwn(p,'nativeLanguage')&&!Object.hasOwn(last,'nativeLanguage'))
       throw Error(context+' period '+i+': native language unresolved');
     if(Object.hasOwn(p,'nativeNames')){
       const options=p.nativeNames;
       if(!Array.isArray(options)||options.length<1||options.length>3)
         throw Error(context+' period '+i+': nativeNames must contain 1-3 entries');
       if(!Object.hasOwn(p,'nameNative')||options[0]?.text!==p.nameNative||
         options[0]?.language!==(p.nativeLanguage||last.nativeLanguage))
         throw Error(context+' period '+i+': nativeNames primary mismatch');
       const keys=new Set();
       for(const option of options){
         requireText(option?.language,context+' nativeNames.language');
         requireText(option?.text,context+' nativeNames.text');
         keys.add(option.language+'\0'+option.text);
       }
       if(keys.size!==options.length)throw Error(context+' period '+i+': duplicated nativeNames');
     }
     for(const key of changed){
       const lang=key==='nameKo'?'ko':key==='nameEn'?'en':p.nativeLanguage||last.nativeLanguage;
       let found=choices.has(lang+'\0'+p[key]);
       if(!found&&(key==='nameEn'||key==='nameNative')){
         const en=p.nameEn??last.nameEn,native=p.nameNative??last.nameNative,nativeLang=p.nativeLanguage??last.nativeLanguage;
         found=en===native&&native===p[key]&&
           (choices.has('en\0'+p[key])||choices.has(nativeLang+'\0'+p[key]));
       }
       if(!found)throw Error(context+' period '+i+': '+key+' not listed in names[]');
       last[key]=p[key];
     }
     if(Object.hasOwn(p,'nativeLanguage'))last.nativeLanguage=p.nativeLanguage;
     if(i===0&&[...SLOTS,'nativeLanguage'].some(key=>!Object.hasOwn(last,key)))
       throw Error(context+': initial period requires ko/en/native and nativeLanguage');
   }
   for(const [slot,field] of Object.entries(DEFAULTS))
     if(last[slot]!==item[field])throw Error(context+': current '+field+' disagrees with last historical period');
   periodCount+=periods.length;
 }
 return {validatedCities:used.size,validatedPeriods:periodCount};
}
export function finalize(source,output,places=PLACES,{check=false}={}){
 const dest=resolve(output);
 if(existsSync(dest))throw Error('Refusing to overwrite '+dest);
 const match=/^tier1-major-cities-batch(\d{2})[-a-z0-9]*\.json$/u.exec(basename(dest));
 if(!match)throw Error('Output must be a numbered tier1-major-cities-batchNN[-slug].json');
 const {files,known}=registered(places);
 if(files.some(name=>new RegExp('batch'+match[1]+'(?:-|\\.)').test(name)))throw Error('Batch '+match[1]+' already exists');
 const data=readJson(source);
 if(!new RegExp('^0*'+Number(match[1])+'(?:-|$)').test(String(data.batch||'')))
   throw Error('Reviewed batch label and output batch number differ');
 const result=validateReviewed(data,known);
 if(!check)writeNewJson(dest,data);
 return result;
}
export async function main(args=process.argv.slice(2)){
 let command;const options={};
 for(let i=0;i<args.length;i++){
   const key=args[i];
   if(['audit','plan','finalize'].includes(key)&&!command){command=key;continue;}
   if(!key.startsWith('--')||!['--places','--candidates','--summary','--batch','--limit','--countries',
       '--min-population','--input','--output','--check','--skip-source-hash-check'].includes(key))
     throw Error('Unknown argument: '+key);
   if(key==='--check'||key==='--skip-source-hash-check'){options[key.slice(2)]=true;continue;}
   if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing value for '+key);
   options[key.slice(2)]=args[++i];
 }
 if(!command)throw Error('Expected audit, plan or finalize');
 const places=options.places||PLACES;
 let result;
 if(command==='audit')result=audit(places);
 else if(command==='plan'){
   const countries=options.countries?.split(',')||[];
   if(countries.some(code=>!/^[A-Z]{2}$/u.test(code)))
     throw Error('--countries must be comma-separated two-letter uppercase codes');
   const candidates=options.candidates||join(places,'.cache/refined-candidates.ndjson');
   result=await plan(candidates,places,{batch:Number(options.batch),limit:options.limit?Number(options.limit):25,
     countries,minPopulation:options['min-population']?Number(options['min-population']):0,
     reviewedSummary:options['skip-source-hash-check']?null:options.summary||join(places,'candidate-review-summary.json')});
   if(options.output)writeNewJson(options.output,result);
 }else{
   if(!options.input||!options.output)throw Error('finalize needs --input and --output');
   result=finalize(options.input,options.output,places,{check:Boolean(options.check)});
 }
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().then(result=>console.log(JSON.stringify(result,null,2)))
   .catch(error=>{console.error('place-batch: '+error.message);process.exitCode=1;});
