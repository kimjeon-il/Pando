// R4-E3: inventory archived editor tests before deleting only retired contracts.
// This script does not edit sources or test fixtures.
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadRepository} from './plan-application-checks.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const load=p=>readFileSync(resolve(root,p),'utf8');
const repo=loadRepository(root);
const sorted=a=>[...a].sort((x,y)=>x.localeCompare(y));
const obsolete=sorted(repo.retiredTests.keys());
const active=sorted(repo.tests.filter(x=>repo.owners.get(x)?.mode!=='retired'));
const activeSet=new Set(active);
const obsoleteSet=new Set(obsolete);
const textFiles=repo.files.filter(x=>/\.(?:m?js|cjs|yml|yaml|json|html|md)$/.test(x) &&
  !x.startsWith('tests/fixtures/portability/')&&
  !x.startsWith('tests/fixtures/geopackage/compat/')&&
  !x.startsWith('apps/editor/frontend/'));
const content=new Map();
for(const file of textFiles){
 try{content.set(file,load(file));}catch{}
}
const candidateHelpers=repo.files.filter(x=>
 /^tests\/(?:helpers|unit\/helpers|browser\/helpers)\//.test(x)&&
 /(?:editor-entry|editor-dom|editable-library|archive-probe|korean-boundary-workflow|mobile-vertex|ui-editor|retired-|legacy-editor)/.test(x));
const extraFixtures=repo.files.filter(x=>/^tests\/fixtures\//.test(x)&&
 !/^tests\/fixtures\/(?:portability|geopackage\/compat)\//.test(x)&&
 /(?:editor|editable-library|old-ui|legacy-ui|draft|vertex|review-old)/.test(x));
const helperRefs=file=>{
 const basename=posix.basename(file);
 return [...content].filter(([p,source])=>p!==file&&
   (source.includes(file)||source.includes(basename))).map(([p])=>p);
};
const helpers=[...new Set([...candidateHelpers,...extraFixtures])].map(file=>{
 const refs=helperRefs(file);
 return {file,activeConsumers:refs.filter(x=>activeSet.has(x)),
   retainedOtherConsumers:refs.filter(x=>!obsoleteSet.has(x)&&!activeSet.has(x)&&
    !x.startsWith('docs/')&&!x.startsWith('tests/fixtures/')),
   obsoleteConsumers:refs.filter(x=>obsoleteSet.has(x)),
   excludedHistoricalOracle:/^tests\/fixtures\/(?:portability|geopackage\/compat)\//.test(file)};
});
const directReferences=[];
const ciReferences=[];
for(const dead of obsolete){
 const filename=posix.basename(dead);
 const referenced=[...content].filter(([path,source])=>path!==dead&&
   (source.includes(dead)||source.includes(filename))).map(([path])=>path);
 const keep=referenced.filter(x=>activeSet.has(x));
 const commands=referenced.filter(x=>x.startsWith('.github/workflows/')||
   (x.startsWith('scripts/')&&!x.includes('r4e3-retirement-inventory.mjs')));
 if(keep.length)directReferences.push({test:dead,active:keep});
 if(commands.length)ciReferences.push({test:dead,commands});
}
const reservedFixtures=helpers.filter(x=>x.activeConsumers.length||x.retainedOtherConsumers.length);
const safeFixtureCandidates=helpers.filter(x=>!x.activeConsumers.length&&!x.retainedOtherConsumers.length);
const inventory={
 schema:'pandolab-r4e3-retirement-inventory-v1',
 baseline:{unit:repo.tests.filter(x=>x.startsWith('tests/unit/')).length,
 browser:repo.tests.filter(x=>x.startsWith('tests/browser/')).length},
 obsolete:obsolete.map(file=>({file,reason:repo.retiredTests.get(file)})),
 retiredCount:obsolete.length,
 retiredUnitCount:obsolete.filter(x=>x.startsWith('tests/unit/')).length,
 retiredBrowserCount:obsolete.filter(x=>x.startsWith('tests/browser/')).length,
 retainedActiveTestCount:active.length,
 directReferences,ciReferences,
 fixtureCandidates:safeFixtureCandidates,
 fixturePreserve:reservedFixtures,
 emptyRetiredGroups:repo.catalog.groups.filter(x=>x.mode==='retired'&&
   !repo.tests.some(p=>repo.owners.get(p)?.id===x.id)).map(x=>x.id),
};
const args=process.argv.slice(2);
if(args.includes('--output')){
 const index=args.indexOf('--output')+1,file=args[index];
 if(!file||!file.startsWith('test-results/')||file.includes('..'))
   throw new Error('R4-E3 inventory output must stay under test-results/');
 mkdirSync(dirname(resolve(root,file)),{recursive:true});
 writeFileSync(resolve(root,file),JSON.stringify(inventory,null,2)+'\n');
}
if(args.includes('--summary')){
 console.log(JSON.stringify({schema:inventory.schema,
  baseline:inventory.baseline,retiredCount:inventory.retiredCount,
  retiredUnitCount:inventory.retiredUnitCount,retiredBrowserCount:inventory.retiredBrowserCount,
  active:inventory.retainedActiveTestCount,activeTestReferences:directReferences.length,
  ciReferences:ciReferences.length,safeFixtureCandidates:safeFixtureCandidates.length,
  protectedFixtureCandidates:reservedFixtures.length,
  retiredTests:obsolete,
  blockers:directReferences,
  ciBlockers:ciReferences,
  fixtureCandidates:safeFixtureCandidates},null,2));
}else console.log(JSON.stringify(inventory,null,2));
if(args.includes('--check')&&obsolete.length){
 console.error('R4-E3 retired tests remain: '+obsolete.length);
 process.exitCode=1;
}
