import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readTerritorialSources,updateTerritorialSource} from '../territorial-entity-sources.mjs';
import {normalizeTerritorialLibraryEntity} from '../../apps/editor/frontend/js/modules/territorial-library.js';

const fail=message=>{throw new Error('ATTRIBUTE_HISTORY_2000_2026: '+message);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const beforeDay=day=>{const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
const names=(common,formal,enCommon=null,enFormal=null)=>({
 ko:{common,...(formal?{formal}:{})},
 ...(enCommon?{en:{common:enCommon,...(enFormal?{formal:enFormal}:{})}}:{})
});
const transitions=[
 {id:'COM',changes:[['2001-12-23',names('코모로','코모로 연합','Comoros','Union of the Comoros')]],
  before:names('코모로','코모로 연방 이슬람 공화국','Comoros','Federal Islamic Republic of the Comoros'),
  sources:['https://www.refworld.org/legal/legislation/natlegbod/2001/75023']},
 {id:'BHR',changes:[['2002-02-14',names('바레인','바레인 왕국','Bahrain','Kingdom of Bahrain')]],
  before:names('바레인','바레인국','Bahrain','State of Bahrain'),
  sources:['https://www.lloc.gov.bh/en/Legislation/id/Constitution']},
 {id:'NPL',changes:[['2008-05-28',names('네팔','네팔 연방민주공화국','Nepal','Federal Democratic Republic of Nepal')]],
  before:names('네팔','네팔 왕국','Nepal','Kingdom of Nepal'),
  sources:['https://www.gov.uk/government/publications/country-names/timeline-of-country-name-changes-in-hmg-use-1919-to-present']},
 {id:'BOL',changes:[['2009-02-07',names('볼리비아','볼리비아 다민족국','Bolivia','Plurinational State of Bolivia')]],
  before:names('볼리비아','볼리비아 공화국','Bolivia','Republic of Bolivia'),
  sources:['https://www.bcb.gob.bo/?q=content%2F63']},
 {id:'MMR',changes:[['2010-10-21',names('미얀마','미얀마 연방공화국','Myanmar','Republic of the Union of Myanmar')]],
  before:names('미얀마','미얀마 연방','Myanmar','Union of Myanmar'),
  sources:['https://www.yna.co.kr/view/AKR20101022148500009']},
 {id:'LBY',changes:[
   ['2011-08-03',names('리비아',null,'Libya','Libya')],
   ['2017-12-22',names('리비아','리비아국','Libya','State of Libya')]],
  before:names('리비아',null,'Libya',"Great Socialist People's Libyan Arab Jamahiriya"),
  sources:['https://www.un.org/en/node/122883']},
 {id:'SWZ',changes:[['2018-04-19',names('에스와티니','에스와티니 왕국','Eswatini','Kingdom of Eswatini')]],
  before:names('스와질란드','스와질란드 왕국','Swaziland','Kingdom of Swaziland'),
  sources:['https://www.thekingdomofeswatini.com/news-blogs/swaziland-becomes-eswatini/']},
 {id:'MKD',changes:[['2019-02-12',names('북마케도니아','북마케도니아 공화국','North Macedonia','Republic of North Macedonia')]],
  before:names('마케도니아','마케도니아 공화국','Macedonia','Republic of Macedonia'),
  sources:['https://www.un.org/sg/en/content/sg/statements/2019-02-13/statement-attributable-the-spokesman-for-the-secretary-general-prespa-agreement']},
 {id:'TUR',changes:[['2022-06-01',names('튀르키예','튀르키예 공화국','Türkiye','Republic of Türkiye')]],
  before:names('터키','터키 공화국','Turkey','Republic of Turkey'),
  sources:['https://turkiye.un.org/en/184798-turkeys-name-changed-t%C3%BCrkiye']},
 {id:'NRU',changes:[['2026-05-12',names('나오에로','나오에로 공화국','Naoero','Republic of Naoero')]],
  before:names('나우루','나우루 공화국','Nauru','Republic of Nauru'),
  sources:['https://ronlaw.gov.nr/docs/any/naoero']},
];
const svg=(body,width=600,height=400)=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'">'+body+'</svg>';
const dataUrl=markup=>'data:image/svg+xml;base64,'+Buffer.from(markup,'utf8').toString('base64');
function star(cx,cy,r,color,rotation=-Math.PI/2){
 const pts=Array.from({length:10},(_,i)=>{
  const a=rotation+i*Math.PI/5,rad=i%2?r*.382:r;
  return (cx+Math.cos(a)*rad).toFixed(3)+','+(cy+Math.sin(a)*rad).toFixed(3);
 }).join(' ');
 return '<polygon points="'+pts+'" fill="'+color+'"/>';
}
const artworks={
 'rwanda-1962':()=>svg('<path fill="#CE1126" d="M0 0h200v400H0z"/><path fill="#FCDD09" d="M200 0h200v400H200z"/><path fill="#007A5E" d="M400 0h200v400H400z"/><text x="300" y="304" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="260" fill="#000">R</text>'),
 'georgia-1990':()=>svg('<rect width="600" height="360" fill="#981E32"/><rect x="0" y="0" width="240" height="72" fill="#111"/><rect x="0" y="72" width="240" height="72" fill="#fff"/>',600,360),
 'libya-1977':()=>svg('<rect width="600" height="400" fill="#009B3A"/>'),
 'syria-1980':()=>svg('<path fill="#CE1126" d="M0 0h600v133.333H0z"/><path fill="#fff" d="M0 133.333h600v133.334H0z"/><path d="M0 266.667h600V400H0z"/>'+star(220,200,56,'#007A3D')+star(380,200,56,'#007A3D')),
 'syria-2024':()=>svg('<path fill="#007A3D" d="M0 0h600v133.333H0z"/><path fill="#fff" d="M0 133.333h600v133.334H0z"/><path d="M0 266.667h600V400H0z"/>'+star(170,200,42,'#CE1126')+star(300,200,42,'#CE1126')+star(430,200,42,'#CE1126')),
 'bahrain-1972':()=>{
  const n=8,step=360/n;let p='M0 0 H148';
  for(let i=0;i<n;i++)p+=' L148 '+(i*step)+' L210 '+((i+.5)*step)+' L148 '+((i+1)*step);
  return svg('<rect width="600" height="360" fill="#CE1126"/><path d="'+p+' L0 360Z" fill="#fff"/>',600,360);
 },
};
const flags=[
 {id:'RWA',start:null,date:'2001-12-31',old:'rwanda-1962',after:'default',
  sources:['https://www.crwflags.com/fotw/flags/rw.html']},
 {id:'BHR',start:'1972-08-19',date:'2002-02-14',old:'bahrain-1972',after:'default',
  sources:['https://www.edunet.bh/e_content/level_1/stage_1/subject_ID_4/Part_3/e_books/Flag--guide---English%281%29/Flag--guide---English%281%29.pdf']},
 {id:'GEO',start:null,date:'2004-01-14',old:'georgia-1990',after:'default',
  sources:['https://www.crwflags.com/fotw/Flags/ge_1990.html']},
 {id:'LBY',start:'1977-11-11',date:'2011-08-23',old:'libya-1977',after:'default',
  sources:['https://www.savaflags.org.za/spec/Libya%20-%20national%20-%201977%20-%202011.pdf']},
 {id:'SYR',start:'1980-03-30',date:'2024-12-08',old:'syria-1980',after:'syria-2024',
  sources:['https://constitutionnet.org/sites/default/files/2025-03/2025.03.13%20-%20Constitutional%20declaration%20%28English%29.pdf']},
];

export const ATTRIBUTE_HISTORY_IDS=Object.freeze([...new Set([...transitions,...flags].map(row=>'state:'+row.id))].sort());
const parentAudit=[
 {id:'state:GRL',required:'state:DNK',explanation:'2009 home-rule reform does not change sovereign parent identity'},
 {id:'state:FRO',required:'state:DNK',explanation:'2005 delegated powers do not change the Danish parent'},
 {id:'state:ABW',required:'state:NLD',explanation:'Aruba remains separately connected to the Kingdom since 1986'},
 {id:'state:CUW',required:'state:NLD',explanation:'Its existing 2010 start already reflects its Kingdom-country relationship'},
 {id:'state:SXM',required:'state:NLD',explanation:'Pre-2010 direct historical parent would require an absent Netherlands Antilles entity'}
];

export function planAttributes(input){
 const byId=new Map(input.map(row=>[row.entityId,row]));
 for(const check of parentAudit){
  const e=byId.get(check.id);
  if(!e||e.parentEntityId!==check.required)fail('Unreviewed parent relation: '+check.id);
 }
 const changed=new Map(),originals=new Map();
 const get=id=>{
  const full='state:'+id,source=byId.get(full);
  if(!source)fail('Missing existing object '+full);
  if(!changed.has(full)){changed.set(full,structuredClone(source));originals.set(full,source);}
  return changed.get(full);
 };
 for(const row of transitions){
  const item=get(row.id),source=originals.get(item.entityId);
  if(source.nameVersions?.length)fail('Existing name history must be merged manually: '+item.entityId);
  const first=row.changes[0][0],history=[];
  // Pre-2000 labels remain searchable without retroactively imposing a
  // modern formal constitutional title on the entire earlier lifetime.
  history.push({validFrom:null,validTo:'1999-12-31',names:{ko:{common:row.before.ko.common},...(row.before.en?{en:{common:row.before.en.common}}:{})}});
  history.push({validFrom:'2000-01-01',validTo:beforeDay(first),names:row.before});
  for(let i=0;i<row.changes.length;i++){
   const [from,edition]=row.changes[i],next=row.changes[i+1]?.[0];
   history.push({validFrom:from,validTo:next?beforeDay(next):null,names:edition});
  }
  item.nameVersions=history;
  const current=row.changes.at(-1)[1];
  item.names.ko=current.ko.common;
  item.names.en=current.en?.common||item.names.en;
  for(const alias of [row.before.ko.common,row.before.ko.formal,row.before.en?.common,row.before.en?.formal,
   ...row.changes.flatMap(([day,x])=>[x.ko.common,x.ko.formal,x.en?.common,x.en?.formal])])
   if(alias&&!item.alternateNames.includes(alias))item.alternateNames.push(alias);
  item.sourceInfo.attributeHistoryEvidence={...(item.sourceInfo.attributeHistoryEvidence||{}),
   officialNames:{scope:'2000-2026',effectiveDates:row.changes.map(([day])=>day),sources:row.sources,
    displayPolicy:'Retain common names unless the country name itself changed; amend formal names otherwise.'}};
 }
 for(const row of flags){
  const item=get(row.id),source=originals.get(item.entityId);
  if(source.metadata?.flagHistory?.length)fail('Existing flag history must be merged manually: '+item.entityId);
  const old=artworks[row.old]();
  const next=row.after==='default'?{policy:'default'}:{policy:'embedded',flagDataUrl:dataUrl(artworks[row.after]())};
  item.metadata.flagHistory=[
   {validFrom:row.start,validTo:beforeDay(row.date),policy:'embedded',flagDataUrl:dataUrl(old)},
   {validFrom:row.date,validTo:null,...next},
  ];
  item.sourceInfo.attributeHistoryEvidence={...(item.sourceInfo.attributeHistoryEvidence||{}),
   flag:{effectiveDate:row.date,sources:row.sources,sourceArtwork:'screen-level public-domain SVG reconstruction',
    note:'Only documented design periods are asserted; existing source flag remains unchanged.'}};
 }
 const updates=[];
 for(const [id,after] of changed){
  const before=originals.get(id);
  if(hash(before.geometryVersions)!==hash(after.geometryVersions))fail('Unexpected geometry change: '+id);
  if(hash(before.lifetime)!==hash(after.lifetime))fail('Unexpected lifetime change: '+id);
  if(before.parentEntityId!==after.parentEntityId)fail('Unexpected parent change: '+id);
  normalizeTerritorialLibraryEntity(after);
  updates.push(after);
 }
 return {updates,notes:parentAudit,flagCount:flags.length,namedCount:transitions.length};
}

function main(argv){
 const apply=argv.includes('--apply'),plan=argv.includes('--plan');
 if(apply===plan)fail('Choose exactly one of --plan and --apply');
 const before=readTerritorialSources();
 const already=before.some(e=>ATTRIBUTE_HISTORY_IDS.includes(e.entityId)
  &&(e.sourceInfo?.attributeHistoryEvidence?.officialNames||e.sourceInfo?.attributeHistoryEvidence?.flag));
 if(already) {
  if(ATTRIBUTE_HISTORY_IDS.some(id=>!before.find(e=>e.entityId===id)?.sourceInfo?.attributeHistoryEvidence))fail('Partial application; preserve and reconcile');
  console.log('ATTRIBUTE_HISTORY_ALREADY_APPLIED');
  return;
 }
 const proposed=planAttributes(before);
 const summary={schemaVersion:1,scope:'official names, flags, existing parent relationships only',
  named:transitions.map(x=>({id:'state:'+x.id,dates:x.changes.map(([d])=>d)})),
  flagged:flags.map(x=>({id:'state:'+x.id,from:x.start,change:x.date})),
  parents:proposed.notes.map(x=>({id:x.id,parent:x.required,change:'none',reason:x.explanation})),
  unchangedGeometry:true,unchangedLifetimes:true};
 if(plan){console.log('ATTRIBUTE_HISTORY_PLAN='+JSON.stringify(summary));return;}
 for(const e of proposed.updates){
  const original=before.find(row=>row.entityId===e.entityId);
  updateTerritorialSource(e.entityId,current=>{
   if(hash(current)!==hash(original))fail('Concurrent source change: '+e.entityId);
   return e;
  });
 }
 const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
 for(const args of [
  ['tools/build-territorial-entity-chunks.mjs','--entities='+ATTRIBUTE_HISTORY_IDS.join(',')],
  ['tools/build-builtin-world.mjs']
 ]){
  execFileSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 }
 console.log('ATTRIBUTE_HISTORY_APPLIED='+JSON.stringify(summary));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
