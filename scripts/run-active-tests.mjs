// Run discovered Viewer feature tests; controlled measurements remain manual.
import {spawnSync} from 'node:child_process';
import {loadRepository} from './plan-application-checks.mjs';
import {requiresUnitIsolation} from './lib/unit-test-isolation.mjs';

const kind=process.argv[2];
if(!['unit','browser'].includes(kind)){
  console.error('Usage: node scripts/run-active-tests.mjs unit|browser [--list|test flags]');
  process.exitCode=2;
}else{
  const repository=loadRepository(new URL('../',import.meta.url));
  const files=repository.tests.filter(file=>file.startsWith('tests/'+kind+'/')
    && repository.owners.get(file)?.mode !== 'manual').sort();
  if(process.argv.includes('--list'))console.log(files.join('\n'));
  else{
    // pnpm can forward its argument separator literally. Passing it through
    // would make Playwright interpret later options (including --output) as
    // positional test filters and use its default output directory instead.
    const forwarded=process.argv.slice(3);
    if(forwarded[0]==='--')forwarded.shift();
    // Keep process argument lists bounded across platforms.
    // Browser specs remain one Playwright invocation to preserve fixtures.
    const groupSize=kind==='unit'?120:files.length||1;
    const ordinary=kind==='unit'?files.filter(file=>!requiresUnitIsolation(file)):files;
    const batches=[];
    for(let at=0;at<ordinary.length;at+=groupSize)batches.push(ordinary.slice(at,at+groupSize));
    if(kind==='unit')for(const file of files)if(requiresUnitIsolation(file))batches.push([file]);
    let failed=false;
    for(const batch of batches){
      const args=kind==='unit'?
        ['--test','--test-concurrency=2',...batch,...forwarded]:
        ['node_modules/@playwright/test/cli.js','test',...batch,'--workers=1',...forwarded];
      const result=spawnSync(process.execPath,args,{cwd:repository.root,stdio:'inherit'});
      if(result.error)throw result.error;
      if(result.status!==0)failed=true;
    }
    process.exitCode=failed?1:0;
  }
}
