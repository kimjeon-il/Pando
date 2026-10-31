import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readTerritorialSources,updateTerritorialSource} from '../territorial-entity-sources.mjs';
import {normalizeTerritorialLibraryEntity} from '../../apps/editor/frontend/js/modules/territorial-library.js';

const error=message=>{throw new Error('ADDITIONAL_2000_2026_ATTRIBUTES: '+message);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const previousDay=date=>{
 const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);
 return d.toISOString().slice(0,10);
};
const datedNames=[
 {id:'CPV',day:'2013-10-24',
  before:{ko:{common:'카보베르데',formal:'카보베르데 공화국'},en:{common:'Cape Verde',formal:'Republic of Cape Verde'}},
  after:{ko:{common:'카보베르데',formal:'카보베르데 공화국'},en:{common:'Cabo Verde',formal:'Republic of Cabo Verde'}},
  sources:['https://www.un.org/en/about-us/member-states/cabo-verde']},
 {id:'CZE',day:'2016-05-17',
  before:{ko:{common:'체코',formal:'체코 공화국'},en:{common:'Czech Republic',formal:'Czech Republic'}},
  after:{ko:{common:'체코',formal:'체코 공화국'},en:{common:'Czechia',formal:'Czech Republic'}},
  sources:['https://mzv.gov.cz/jnp/en/issues_and_press/factsheets/x2016_04_21_the_completion_of_translations_of_the.html']},
 {id:'SOM',day:'2012-08-01',
  before:{ko:{common:'소말리아'},en:{common:'Somalia'}},
  after:{ko:{common:'소말리아',formal:'소말리아 연방공화국'},en:{common:'Somalia',formal:'Federal Republic of Somalia'}},
  sources:['https://faolex.fao.org/en/documents/LEX-FAOC127387/provisional-constitution-of-the-federal-republic-of-somalia-som-2012']},
];
const flagRows=[
 {id:'COD',phases:[
  ['2000-01-01','2006-02-17','Flag_of_the_Democratic_Republic_of_the_Congo_(1997–2006).svg'],
  ['2006-02-18',null,'default']],
  sources:['https://en.wikipedia.org/wiki/Flag_of_the_Democratic_Republic_of_the_Congo']},
 {id:'VEN',phases:[
  ['2000-01-01','2006-03-11','State_flag_of_Venezuela_(1954–2006).svg'],
  ['2006-03-12',null,'default']],
  sources:['https://en.wikipedia.org/wiki/Flag_of_Venezuela']},
 {id:'LSO',phases:[
  ['2000-01-01','2006-10-03','Flag_of_Lesotho_(1987–2006).svg'],
  ['2006-10-04',null,'default']],
  sources:['https://en.wikipedia.org/wiki/Flag_of_Lesotho']},
 {id:'IRQ',phases:[
  ['2000-01-01','2003-12-31','Flag_of_Iraq_(1991–2004).svg'],
  ['2004','2008-01-21','Flag_of_Iraq_(2004–2008).svg'],
  ['2008-01-22',null,'default']],
  sources:['https://2001-2009.state.gov/documents/organization/99769.pdf'],
  caveat:'The 2004 script change is documented only to year precision, not an invented day.'},
 {id:'MWI',phases:[
  ['2000-01-01','2010-07-28','default'],
  ['2010-07-29','2012-05-27','Flag_of_Malawi_(2010–2012).svg'],
  ['2012-05-28',null,'default']],
  sources:['https://www.crwflags.net/fotw/flags/mw-01.html']},
 {id:'MMR',phases:[
  ['2000-01-01','2010-10-20','Flag_of_Myanmar_(1974–2010).svg'],
  ['2010-10-21',null,'default']],
  sources:['https://commons.wikimedia.org/wiki/File:Flag_of_Myanmar_(1974–2010).svg']},
 {id:'MRT',phases:[
  ['2000-01-01','2017-11-27','Flag_of_Mauritania_(1959–2017).svg'],
  ['2017-11-28',null,'default']],
  sources:['https://www.chathamhouse.org/sites/default/files/2019-04-10-Mauritania.pdf'],
  caveat:"Referendum and constitutional adoption occurred earlier in August; changed flag's public display is effective by 2017-11-28."},
 {id:'KGZ',phases:[
  ['2000-01-01','2023-12-25','Flag_of_Kyrgyzstan_(1992–2023).svg'],
  ['2023-12-26',null,'default']],
  sources:['https://www.president.kg/ru/about/symbol']},
];
export const ADDITIONAL_NAME_IDS=Object.freeze(datedNames.map(x=>'state:'+x.id));
export const ADDITIONAL_FLAG_IDS=Object.freeze(flagRows.map(x=>'state:'+x.id));
export const ADDITIONAL_IDS=Object.freeze([...ADDITIONAL_NAME_IDS,...ADDITIONAL_FLAG_IDS].sort());
const allMediaNames=[...new Set(flagRows.flatMap(x=>x.phases.map(y=>y[2]).filter(y=>y!=='default')))];

function mediaURL(filename){
 const sha=createHash('md5').update(filename).digest('hex');
 return 'https://upload.wikimedia.org/wikipedia/commons/'+sha[0]+'/'+sha.slice(0,2)+'/'+encodeURIComponent(filename);
}
function validateSVG(markup,name){
 if(typeof markup!=='string'||markup.length<80||markup.length>900000)error('Invalid historical SVG bytes: '+name);
 const start=markup.search(/<svg\b/i);
 if(start<0)error('Missing SVG root: '+name);
 const svg=markup.slice(start).trim();
 if(!/<\/svg>\s*$/i.test(svg))error('SVG close tag missing: '+name);
 if(/<(?:script|foreignObject|iframe|object|embed)\b|(?:\s|<)on[a-z]+\s*=|(?:xlink:)?href\s*=\s*["']\s*(?:https?:|javascript:)/i.test(svg))
  error('Unsafe or externally dependent historical SVG: '+name);
 return svg;
}
export function prepareAdditionalAttributePlan(input,artwork={}){
 const all=new Map(input.map(e=>[e.entityId,e]));
 const updated=new Map(),originals=new Map();
 function get(id){
  const key='state:'+id,orig=all.get(key);
  if(!orig)error('No existing country object '+key);
  if(!updated.has(key)){updated.set(key,structuredClone(orig));originals.set(key,orig);}
  return updated.get(key);
 }
 for(const row of datedNames){
  const e=get(row.id),old=originals.get(e.entityId);
  if(old.nameVersions?.length)error('Existing name editions require reconciliation: '+e.entityId);
  if(old.names.ko!==row.after.ko.common)error('Unexpected current common name for '+e.entityId);
  e.nameVersions=[
   {validFrom:null,validTo:previousDay(row.day),names:row.before},
   {validFrom:row.day,validTo:null,names:row.after}
  ];
  e.names.en=row.after.en.common;
  for(const x of [...Object.values(row.before.ko),...Object.values(row.before.en),
                  ...Object.values(row.after.ko),...Object.values(row.after.en)])
   if(x&&!e.alternateNames.includes(x))e.alternateNames.push(x);
  e.sourceInfo.attributeHistoryEvidence={...(e.sourceInfo.attributeHistoryEvidence||{}),
   officialNames:{scope:'2000-2026',effectiveDates:[row.day],sources:row.sources,
    displayPolicy:'Preserve Korean common country name for short-form-only and formal-only changes.'}};
 }
 for(const row of flagRows){
  const e=get(row.id),old=originals.get(e.entityId);
  if(old.metadata?.flagHistory?.length)error('Existing historical flag editions require reconciliation: '+e.entityId);
  const editions=[];
  for(const [from,to,file] of row.phases){
   if(file==='default')editions.push({validFrom:from,validTo:to,policy:'default'});
   else {
    const svg=validateSVG(artwork[file],file);
    const flagDataUrl='data:image/svg+xml;base64,'+Buffer.from(svg,'utf8').toString('base64');
    editions.push({validFrom:from,validTo:to,policy:'embedded',flagDataUrl});
   }
  }
  e.metadata.flagHistory=editions;
  e.sourceInfo.attributeHistoryEvidence={...(e.sourceInfo.attributeHistoryEvidence||{}),
   flag:{scope:'2000-2026',sources:row.sources,
    artwork:row.phases.filter(x=>x[2]!=='default').map(x=>({
     file:x[2],url:mediaURL(x[2]),sha256:digest(artwork[x[2]])})),
    ...(row.caveat?{note:row.caveat}:{}),
    sourceArtwork:'Wikimedia Commons historical SVG (see individual source-page licenses); used only for original historical artwork.'}};
 }
 for(const [id,e] of updated){
  const old=originals.get(id);
  if(digest(e.geometryVersions)!==digest(old.geometryVersions))error('Geometry changed: '+id);
  if(digest(e.lifetime)!==digest(old.lifetime))error('Lifetime changed: '+id);
  if(e.parentEntityId!==old.parentEntityId)error('Parent modified: '+id);
  normalizeTerritorialLibraryEntity(e);
 }
 return [...updated.values()];
}
async function loadHistoricalArtwork(){
 const headers={'User-Agent':'PandoHistoricalGIS/1.0 (https://github.com/kimjeon-il/Pando; historical flags research)','Accept':'image/svg+xml'};
 const settled=await Promise.all(allMediaNames.map(async filename=>{
  const url=mediaURL(filename);
  const resp=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});
  if(!resp.ok)error('Historical file unavailable: '+filename+' HTTP '+resp.status+' at '+url);
  const size=Number(resp.headers.get('content-length')||0);
  if(size>900000)error('Historic SVG too large: '+filename);
  const svg=validateSVG(await resp.text(),filename);
  console.log('HISTORIC_FLAG_SOURCE='+JSON.stringify({filename,bytes:Buffer.byteLength(svg),url,sha256:digest(svg)}));
  return [filename,svg];
 }));
 return Object.fromEntries(settled);
}

async function main(argv){
 const apply=argv.includes('--apply'),plan=argv.includes('--plan');
 if(apply===plan)error('Use exactly one of --apply and --plan');
 const before=readTerritorialSources(),byId=new Map(before.map(e=>[e.entityId,e]));
 const done=ADDITIONAL_IDS.filter(id=>byId.get(id)?.sourceInfo?.attributeHistoryEvidence
   &&(ADDITIONAL_NAME_IDS.includes(id)
     ?byId.get(id).sourceInfo.attributeHistoryEvidence.officialNames
     :byId.get(id).sourceInfo.attributeHistoryEvidence.flag));
 if(done.length){
  if(done.length!==ADDITIONAL_IDS.length)error('Partially applied additional source history; inspect before retry');
  console.log('ADDITIONAL_ATTR_ALREADY_APPLIED='+JSON.stringify({names:ADDITIONAL_NAME_IDS,flags:ADDITIONAL_FLAG_IDS}));
  return;
 }
 for(const id of ADDITIONAL_IDS)if(!byId.has(id))error('Historical country object does not exist: '+id);
 if(plan){
  console.log('ADDITIONAL_ATTR_PLAN='+JSON.stringify({nameEvents:datedNames.map(x=>[x.id,x.day]),
    flagEvents:flagRows.map(x=>({id:x.id,phases:x.phases.map(y=>y.slice(0,2))})),
    unchangedGeometry:true,unchangedLifetime:true,unchangedParent:true,
    historicalArtworks:allMediaNames.map(mediaURL)}));
  return;
 }
 const art=await loadHistoricalArtwork();
 const changed=prepareAdditionalAttributePlan(before,art);
 for(const value of changed){
  const original=byId.get(value.entityId);
  updateTerritorialSource(value.entityId,current=>{
   if(digest(current)!==digest(original))error('Concurrent source change: '+value.entityId);
   return value;
  });
 }
 const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
 for(const args of [
  ['tools/build-territorial-entity-chunks.mjs','--entities='+ADDITIONAL_IDS.join(',')],
  ['tools/build-builtin-world.mjs']
 ])execFileSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 console.log('ADDITIONAL_ATTR_APPLIED='+JSON.stringify({named:ADDITIONAL_NAME_IDS,flagged:ADDITIONAL_FLAG_IDS,
  coordinateChanges:0,parentChanges:0,lifetimeChanges:0}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main(process.argv.slice(2)).catch(err=>{console.error(err);process.exitCode=1;});
