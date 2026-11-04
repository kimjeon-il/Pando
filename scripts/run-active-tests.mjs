// Run registered, supported application tests only. Archived editor and manual
// performance/probe suites are deliberately not part of the default product test.
import {spawnSync} from 'node:child_process';
import {loadRepository} from './plan-application-checks.mjs';

const kind=process.argv[2];
if(!['unit','browser'].includes(kind)){
  console.error('Usage: node scripts/run-active-tests.mjs unit|browser [--list|test flags]');
  process.exitCode=2;
}else{
  const repository=loadRepository(new URL('../',import.meta.url));
  const files=repository.tests.filter(file=>file.startsWith('tests/'+kind+'/')
    && !['retired','manual'].includes(repository.owners.get(file)?.mode)).sort();
  if(process.argv.includes('--list'))console.log(files.join('\n'));
  else{
    // Keep Windows command lines well below the 32 KiB process limit.
    // Browser specs remain one Playwright invocation to preserve fixtures.
    const groupSize=kind==='unit'?120:files.length||1;
    // Report hydration tests share a worktree view. The cleanup fixture also
    // requires system-wide Git idleness, so do not overlap it with Git tests.
    const exclusive=new Set(['tests/unit/place-publication.test.mjs','tests/unit/place-sync-contract.test.mjs',
      'tests/unit/reference-cache-cleanup.test.mjs']);
    const ordinary=kind==='unit'?files.filter(file=>!exclusive.has(file)):files;
    const batches=[];
    for(let at=0;at<ordinary.length;at+=groupSize)batches.push(ordinary.slice(at,at+groupSize));
    if(kind==='unit')for(const file of files)if(exclusive.has(file))batches.push([file]);
    let failed=false;
    for(const batch of batches){
      const args=kind==='unit'?
        ['--test','--test-concurrency=2',...batch,...process.argv.slice(3)]:
        ['node_modules/@playwright/test/cli.js','test',...batch,'--workers=1',...process.argv.slice(3)];
      const result=spawnSync(process.execPath,args,{cwd:repository.root,stdio:'inherit'});
      if(result.error)throw result.error;
      if(result.status!==0)failed=true;
    }
    process.exitCode=failed?1:0;
  }
}
