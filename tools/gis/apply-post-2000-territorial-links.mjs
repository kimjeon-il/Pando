import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readTerritorialSources,readTerritorialLineages,territorialSourceRoot,entityFileName,updateTerritorialSource} from '../territorial-entity-sources.mjs';
import {writeLibraryOutput} from '../library-data.mjs';
import {normalizeTerritorialLibraryEntity,normalizeTerritorialLineage} from '../../apps/editor/frontend/js/modules/territorial-library.js';

const ids={untaet:'state:untaet-east-timor',unmik:'state:unmik-kosovo'};
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const requireFact=(yes,why)=>{if(!yes)throw Error('POST2000_COUNTRY: '+why);};
const reusable=(e,id)=>{const v=e.geometryVersions.find(x=>x.versionId===id);requireFact(!!v,'Missing geometry '+id);return v;};

function transitional(id,lineageId,ko,en,origin,original,from,to,authority,evidence){
 const versionId=id+':existing-outline-proxy';
 return {
  schemaVersion:2,entityId:id,entityKind:'general',lineageId,names:{ko,en},alternateNames:[],
  lifetime:{validFrom:from,validTo:to},parentEntityId:'',
  geometryVersions:[{versionId,validFrom:from,validTo:to,certainty:'low',
   sourceId:'existing-natural-earth-outline-temporal-proxy',geometry:structuredClone(original.geometry),
   notes:'Unchanged modern outline reused for a UN-administered non-sovereign territory. Exact historical limits unverified.',
   instantiation:{mode:'territory-replacement',countryUpdates:{}},
   historicalProvenance:{sourceEntityId:origin.entityId,sourceGeometryVersionId:original.versionId,
    verifiedHistoricalGeometry:false,evidence}}],
  instantiation:{mode:'territory-replacement',countryUpdates:{}},
  metadata:{politicalStatus:'UN-administered-non-sovereign-territory',administeringAuthority:authority,
   sovereigntyNotConferred:true,approximateGeometry:true,
   representativeGeometryVersionId:versionId},
  sourceInfo:{sourceId:'existing-country-outline-temporal-proxy',
   title:'UN interim administration using previously archived Natural Earth outline',
   license:'Natural Earth public domain',
   notes:'Historical territorial administration, not a new sovereign nation or a domestic province.',
   evidence}
 };
}

export function planPost2000CountryLinks(sources,lineages,policy){
 const byId=new Map(sources.map(x=>[x.entityId,x]));
 const get=id=>{requireFact(byId.has('state:'+id),'Missing state:'+id);return byId.get('state:'+id);};
 const yugo=get('yugoslavia'),tls=get('TLS'),kos=get('KOS'),srb=get('SRB'),mne=get('MNE'),
  sd=get('SDN'),ss=get('SDS');
 const already=byId.has(ids.untaet)||byId.has(ids.unmik)||yugo.geometryVersions.some(x=>x.versionId==='state:serbia-montenegro:2003-2006-r1');
 if(already){
  requireFact(byId.has(ids.untaet)&&byId.has(ids.unmik)&&yugo.geometryVersions.some(x=>x.versionId==='state:serbia-montenegro:2003-2006-r1'),
   'Partial prior application: manual reconciliation required');
  return {already:true,updated:[],created:[],lineages:[],policy};
 }
 const fry=reusable(yugo,'state:federal-republic-of-yugoslavia:1992-2003-r1');
 const tlsOriginal=reusable(tls,'state:TLS:2002-2026-independence-r1');
 const kosOriginal=kos.geometryVersions[0];
 requireFact(fry.validTo==='2003-02-04','FRY source interval changed');
 requireFact(tls.lifetime.validFrom==='2002-05-20'&&kos.lifetime.validFrom==='2008-02-17','Independent-state start dates changed');
 requireFact(srb.lifetime.validFrom==='2006-06-05'&&mne.lifetime.validFrom==='2006-06-03','User-approved Serbia/Montenegro dates changed');
 requireFact(reusable(sd,'state:sudan:1956-2011-r1').validTo==='2011-07-08'
  && reusable(ss,'state:SDS:2011-07-09-independence-r1').validFrom==='2011-07-09','Sudan split no longer matches existing source');
 const changed=structuredClone(yugo),old=reusable(changed,fry.versionId);
 old.validTo='2003-02-03';
 const union={...structuredClone(fry),versionId:'state:serbia-montenegro:2003-2006-r1',
  validFrom:'2003-02-04',validTo:'2006-06-02',notes:'Serbia and Montenegro state union; exact reuse of FRY country outline.',
  historicalProvenance:{sourceEntityId:yugo.entityId,sourceGeometryVersionId:fry.versionId,
   verifiedHistoricalGeometry:false,evidence:['https://unmik.unmissions.org/en/united-nations-resolution-1244']}};
 changed.geometryVersions.push(union);
 changed.lifetime.validTo='2006-06-02';
 changed.nameVersions=[
  {validFrom:'1918-12-01',validTo:'2003-02-03',names:{ko:{common:'유고슬라비아'},en:{common:'Yugoslavia'}}},
  {validFrom:'2003-02-04',validTo:'2006-06-02',names:{ko:{common:'세르비아 몬테네그로',formal:'세르비아 몬테네그로 국가연합'},
   en:{common:'Serbia and Montenegro',formal:'State Union of Serbia and Montenegro'}}}
 ];
 for(const alias of ['세르비아 몬테네그로 국가연합','Serbia and Montenegro'])if(!changed.alternateNames.includes(alias))changed.alternateNames.push(alias);
 changed.metadata.representativeGeometryVersionId=union.versionId;
 const oldRecipe=changed.sourceInfo?.geometryRecipes?.find(x=>x.id==='historical-country:federal-republic-of-yugoslavia:1992-2003-r1');
 requireFact(!!oldRecipe,'Missing FRY source geometry recipe');
 oldRecipe.validTo='2003-02-03';
 changed.sourceInfo.geometryRecipes.push({...structuredClone(oldRecipe),
  id:'historical-country:serbia-montenegro:2003-2006-r1',validFrom:'2003-02-04',validTo:'2006-06-02',notes:union.notes});
 if(changed.sourceInfo?.importProvenance?.versionIds)
  changed.sourceInfo.importProvenance.versionIds[union.versionId]='historical-country:serbia-montenegro:2003-2006-r1';
 const created=[
  transitional(ids.untaet,'tls','동티모르 유엔 과도행정부','United Nations Transitional Administration in East Timor',
   tls,tlsOriginal,'1999-10-25','2002-05-19','UNTAET',
   ['https://digitallibrary.un.org/record/291410','https://peacekeeping.un.org/sites/default/files/past/etimor/etimor.htm']),
  transitional(ids.unmik,'kos','코소보 유엔 임시행정','Kosovo under United Nations interim administration',
   kos,kosOriginal,'1999-06-10','2008-02-16','UNMIK',
   ['https://unmik.unmissions.org/en/united-nations-resolution-1244'])
 ];
 const nextLineages=structuredClone(lineages).filter(x=>x.lineageId==='tls'||x.lineageId==='kos');
 for(const [lineageId,newId,successor] of [['tls',ids.untaet,'state:TLS'],['kos',ids.unmik,'state:KOS']]){
  const l=nextLineages.find(x=>x.lineageId===lineageId);
  requireFact(l&&l.entityRefs.length===1&&l.entityRefs[0]===successor,'Lineage changed: '+lineageId);
  l.entityRefs.unshift(newId);l.relations.push({type:'successor',from:newId,to:successor});
  normalizeTerritorialLineage(l);
 }
 requireFact(policy.schemaVersion===1&&Array.isArray(policy.replacements),'Invalid territorial policy');
 const updatedPolicy=structuredClone(policy);
 updatedPolicy.replacements.push({targetEntityId:'state:yugoslavia',priorityEntityId:ids.unmik,
  validFrom:'1999-06-10',validTo:'2006-06-02',
  basis:{sourceEntityId:ids.unmik,scope:'Interim administration, not a sovereignty transfer'}});
 for(const entity of [changed,...created])normalizeTerritorialLibraryEntity(entity);
 requireFact(sha(old.geometry)===sha(fry.geometry)&&sha(union.geometry)===sha(fry.geometry),'Yugoslav geometry changed');
 requireFact(sha(created[0].geometryVersions[0].geometry)===sha(tlsOriginal.geometry),'Timor geometry changed');
 requireFact(sha(created[1].geometryVersions[0].geometry)===sha(kosOriginal.geometry),'Kosovo geometry changed');
 return {already:false,updated:[changed],created,lineages:nextLineages,policy:updatedPolicy,
  unchangedSourceIds:['state:TLS','state:KOS','state:SRB','state:MNE','state:SDN','state:SDS'],
  sourceCoordinatesReused:3};
}

function main(args) {
 requireFact(args.includes('--plan')!==args.includes('--apply'),'Choose --plan or --apply');
 const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
 const policyPath=path.join(root,'assets/data/historical-world/policy.json');
 const plan=planPost2000CountryLinks(readTerritorialSources(),readTerritorialLineages(),JSON.parse(fs.readFileSync(policyPath,'utf8')));
 const summary={alreadyApplied:plan.already,updated:plan.updated.map(x=>x.entityId),
  created:plan.created.map(x=>x.entityId),reusedCoordinates:plan.sourceCoordinatesReused||0};
 if(!args.includes('--apply')||plan.already){console.log(JSON.stringify(summary,null,2));return;}
 const write=(p,o)=>writeLibraryOutput(p,JSON.stringify(o,null,2)+'\n');
 for(const e of plan.updated)updateTerritorialSource(e.entityId,previous=>{
  requireFact(previous.lifetime.validTo==='2003-02-04','Concurrent source edit');
  return e;
 });
 for(const e of plan.created){
  const p=path.join(territorialSourceRoot,'countries',entityFileName(e.entityId));
  requireFact(!fs.existsSync(p),'Destination exists: '+p);write(p,e);
 }
 for(const l of plan.lineages)write(path.join(territorialSourceRoot,'lineages',l.lineageId+'.json'),l);
 write(policyPath,plan.policy);
 // A catalog source edit alone is not deployable: regenerate matching chunks and builtin world.
 for(const file of ['tools/build-territorial-entity-chunks.mjs','tools/build-builtin-world.mjs'])
  execFileSync(process.execPath,[file],{cwd:root,stdio:'inherit'});
 console.log(JSON.stringify(summary,null,2));
 console.log('Materialized source and runtime have been updated locally, but no Git pin, branch, or website was published.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2));
