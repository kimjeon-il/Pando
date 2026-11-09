import {readdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import YAML from 'yaml';

const extractTests=s=>[...new Set([...String(s).matchAll(/tests\/(?:unit|native|browser|integration|cpp)\/[A-Za-z0-9_./-]+\.(?:test|spec)\.mjs/g)].map(x=>x[0]))].sort();
const triggers=on=>typeof on==='string'?[on]:Array.isArray(on)?on:Object.keys(on||{});
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':
  value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':
  JSON.stringify(value);
const literalFilter=value=>Array.isArray(value)&&value.length>0&&
  value.every(x=>typeof x==='string'&&!/[!*?\\[\\]{}]/.test(x));
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
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(process.argv[2]||'.github/workflows');
 const report=auditWorkflowCheckOwners(root);
 if(process.argv.includes('--summary'))console.log(JSON.stringify({workflowCount:report.workflowCount,jobCount:report.jobCount,
   automatic:report.automatic,manualOnly:report.manualOnly,multiOwnerTestCount:report.multiOwnerTestCount,
   duplicateJobs:report.duplicateJobs,issues:report.issues}));
 else console.log(JSON.stringify(report,null,2));
 if(report.issues.length||report.duplicateJobs.length)process.exitCode=1;
}
