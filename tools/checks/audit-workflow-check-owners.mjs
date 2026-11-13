import {readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import YAML from 'yaml';

const extractTests=s=>[...new Set([...String(s).matchAll(/tests\/(?:unit|native|browser|integration|cpp)\/[A-Za-z0-9_./-]+\.(?:test|spec)\.mjs/g)].map(x=>x[0]))].sort();
const triggers=on=>typeof on==='string'?[on]:Array.isArray(on)?on:Object.keys(on||{});
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':
  JSON.stringify(value);
const globSyntax=new Set(['*','?','!','[',']','{','}']);
const literalFilter=value=>Array.isArray(value)&&value.length>0&&
  value.every(x=>typeof x==='string'&&![...x].some(char=>globSyntax.has(char)));
const filterOverlap=(left,right)=>{
  if(!literalFilter(left)||!literalFilter(right))return true;
  return left.some(item=>right.includes(item));
};
function eventsOverlap(a,b){
  return a.events.some(event=>{
    if(!b.events.includes(event))return false;
    const x=a.trigger?.[event],y=b.trigger?.[event];
    return ['branches','tags','paths'].every(k=>filterOverlap(x?.[k],y?.[k]));
  });
}
export function auditWorkflowCheckOwners(directory){
 const rows=[],issues=[],duplicateJobs=[];
 for(const file of readdirSync(directory).filter(x=>/\.ya?ml$/.test(x)).sort()){
  const wf=YAML.parse(readFileSync(join(directory,file),'utf8'),{uniqueKeys:true});
  if(!wf||typeof wf!=='object'||typeof wf.jobs!=='object'||!wf.on)
   {issues.push({file,error:'missing jobs or triggers'});continue;}
  const on=triggers(wf.on),automatic=on.some(t=>t!=='workflow_dispatch');
  for(const [jobName,job] of Object.entries(wf.jobs)){
   const steps=(job.steps||[]).filter(x=>x&&typeof x==='object');
   const run=steps.filter(x=>typeof x.run==='string').map(x=>x.run.trim());
   const uses=steps.filter(x=>typeof x.uses==='string').map(x=>x.uses);
   const selectedTests=[...new Set(run.flatMap(extractTests))].sort();
   // Exact execution equivalence only. Matching an individual test name is NOT
   // grounds to remove a native, publication, browser or GIS source gate.
   // A duplicate requires equivalent *complete execution conditions*, not
   // just matching command strings (which can depend on env, matrix, working
   // directory, action inputs, platform or source selection).
   const checkSignature=stable({runsOn:job['runs-on']??null,container:job.container??null,
     strategy:job.strategy??null,needs:job.needs??null,condition:job.if??null,
     env:job.env??null,defaults:job.defaults??null,
     permissions:job.permissions??wf.permissions??null,
     steps:steps.map(step=>Object.fromEntries(Object.entries(step).filter(([key])=>key!=='name'))) });
   rows.push({file,job:jobName,events:on,trigger: wf.on, condition:job.if??null, automatic,tests:selectedTests,
     commands:run.length,externalActions:uses.length,checkSignature});
  }
 }
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];
  if(a.file!==b.file&&a.automatic&&b.automatic&&a.checkSignature===b.checkSignature
    &&a.commands>0&&eventsOverlap(a,b))
    duplicateJobs.push({left:a.file+':'+a.job,right:b.file+':'+b.job,
      reason:'identical full step inventory on overlapping event class'});
 }
 const perFile=Object.groupBy(rows,row=>row.file);
 const workflows=Object.entries(perFile).map(([file,jobs])=>({
  file,events:[...new Set(jobs.flatMap(row=>row.events))],
  mode:jobs.some(row=>row.automatic)?'automatic':'manual-only',
  jobs:jobs.length,tests:[...new Set(jobs.flatMap(row=>row.tests))].sort(),
  commands:jobs.reduce((n,row)=>n+row.commands,0),
 }));
 const testOwners=new Map();
 for(const row of rows)for(const test of row.tests){
  if(!testOwners.has(test))testOwners.set(test,new Map());
  testOwners.get(test).set(row.file,{file:row.file,automatic:row.automatic,events:row.events});
 }
 const multiOwnerTests=[...testOwners].filter(([,owners])=>owners.size>1)
  .map(([test,owners])=>({test,owners:[...owners.values()]}));


 return {schema:'pando-workflow-check-ownership-v1',workflowCount:workflows.length,
  jobCount:rows.length,automatic:workflows.filter(w=>w.mode==='automatic').length,
  manualOnly:workflows.filter(w=>w.mode==='manual-only').length,
  multiOwnerTestCount:multiOwnerTests.length,multiOwnerTests,
  workflows,duplicateJobs,issues};
}

/**
 * One reviewed classification for every GitHub Actions workflow.
 * An opt-in or archival workflow must never silently acquire push/PR triggers.
 */
export function auditWorkflowInventory(directory, manifestPath) {
 const issues=[],add=(file,error)=>issues.push({file,error});
 let manifest;
 try{manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}
 catch(error){return{ok:false,workflowCount:0,counts:{},issues:[{file:manifestPath,error:error.message}]};}
 if(manifest?.schema!=='pando-workflow-inventory-v1')add(manifestPath,'Invalid workflow inventory schema');
 if(manifest?.canonicalApplication!=='application-architecture.yml')add(manifestPath,'Invalid canonical application check owner');
 const groups={continuous:Object.keys(manifest?.continuous||{}),manual:manifest?.manual,historical:manifest?.historical};
 if(!manifest?.continuous||typeof manifest.continuous!=='object'||Array.isArray(manifest.continuous))
  add(manifestPath,'Continuous entries must map to independent purposes');
 for(const [file,purpose] of Object.entries(manifest?.continuous||{}))
  if(typeof purpose!=='string'||!purpose.trim())add(file,'Continuous workflow needs an independent purpose');
 for(const tier of ['manual','historical'])if(!Array.isArray(groups[tier])){
  add(manifestPath,tier+' entries must be arrays');groups[tier]=[];
 }
 const delegated=manifest?.delegatedToCanonical||{};
 if(!delegated||typeof delegated!=='object'||Array.isArray(delegated))
  add(manifestPath,'Delegated check owners must map to the canonical application workflow');
 const owners=new Map();
 for(const [tier,entries] of Object.entries(groups))for(const file of entries){
  if(typeof file!=='string'||!/^[\w-]+\.ya?ml$/.test(file)){add(manifestPath,'Invalid workflow name in '+tier);continue;}
  if(owners.has(file))add(file,'Workflow belongs to multiple tiers: '+owners.get(file)+' and '+tier);
  owners.set(file,tier);
 }
 for(const [file,reason] of Object.entries(delegated||{})){
  if(owners.get(file)!=='manual')add(file,'Delegated application-only workflow must be manual');
  if(typeof reason!=='string'||!reason.trim())add(file,'Delegated workflow needs its canonical replacement reason');
 }
 const actual=readdirSync(directory).filter(file=>/\.ya?ml$/.test(file)).sort(),present=new Set(actual);
 for(const file of actual)if(!owners.has(file))add(file,'Workflow missing from canonical inventory');
 for(const file of owners.keys())if(!present.has(file))add(file,'Inventory references a missing workflow');
 for(const file of actual){
  let wf;
  try{wf=YAML.parse(readFileSync(join(directory,file),'utf8'),{uniqueKeys:true});}
  catch(error){add(file,'Cannot parse workflow YAML: '+error.message);continue;}
  const events=triggers(wf?.on),tier=owners.get(file);
  if(!wf?.on||!wf.jobs||typeof wf.jobs!=='object')add(file,'Workflow is missing triggers or jobs');
  const automatic=events.filter(event=>event!=='workflow_dispatch'&&event!=='workflow_call');
  if(tier==='continuous'&&!automatic.length)add(file,'Continuous workflow has no automatic trigger');
  if((tier==='manual'||tier==='historical')&&automatic.length)
   add(file,tier+' workflow has automatic triggers: '+automatic.join(', '));
  if((tier==='manual'||tier==='historical')&&!events.includes('workflow_dispatch'))
   add(file,tier+' workflow must be opt-in via workflow_dispatch');
  if(file===manifest?.canonicalApplication&&tier!=='continuous')
   add(file,'Canonical application owner must be continuous');
 }
 return{ok:issues.length===0,workflowCount:actual.length,
  counts:Object.fromEntries(Object.entries(groups).map(([tier,files])=>[tier,files.length])),
  canonicalApplication:manifest?.canonicalApplication,issues};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'.github/workflows');
 const report=auditWorkflowCheckOwners(root);
 const inventory=auditWorkflowInventory(root,resolve('scripts/contracts/workflow-inventory.json'));
 if(process.argv.includes('--summary'))console.log(JSON.stringify({workflowCount:report.workflowCount,jobCount:report.jobCount,
   automatic:report.automatic,manualOnly:report.manualOnly,multiOwnerTestCount:report.multiOwnerTestCount,
   duplicateJobs:report.duplicateJobs,issues:report.issues,inventory}));
 else console.log(JSON.stringify({...report,inventory},null,2));
 if(report.issues.length||report.duplicateJobs.length||!inventory.ok)process.exitCode=1;
}
