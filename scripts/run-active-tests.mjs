// Run discovered Viewer feature tests; controlled measurements remain manual.
import {spawnSync} from 'node:child_process';
import {loadRepository} from './plan-application-checks.mjs';
import {planUnitTestBatches} from './lib/unit-test-batches.mjs';
import {executePlan} from './run-application-checks.mjs';

const kind=process.argv[2];
if (!['unit','browser'].includes(kind)) {
  console.error('Usage: node scripts/run-active-tests.mjs unit|browser [--list|test flags]');
  process.exitCode=2;
} else {
  const repository=loadRepository(new URL('../',import.meta.url));
  const files=repository.tests.filter(file=>file.startsWith('tests/'+kind+'/')
    && repository.owners.get(file)?.mode!=='manual').sort();
  if (process.argv.includes('--list')) console.log(files.join('\n'));
  else {
    const forwarded=process.argv.slice(3);
    if (forwarded[0]==='--') forwarded.shift();
    if (kind==='unit' && process.env.GITHUB_ACTIONS==='true') {
      // Full CI runs prepare the same source-pinned Core/Native prerequisites
      // as the affected-only runner; no test is silently skipped for missing tools.
      const unitTestPrerequisites=Object.fromEntries(files.map(file=>[
        file, [...(repository.unitRequirements.get(file)||[])].sort()
      ]).filter(([,required])=>required.length));
      const plan={changedFiles:[],unitTests:files,unitTestPrerequisites,commands:[],
        browserSpecs:[],browserPrerequisites:[],prerequisites:[],externalChecks:[]};
      const result=executePlan(plan,{repository,phase:'non-browser',unitTestArgs:forwarded});
      process.exitCode=result.ok?0:1;
    } else {
    const batches=kind==='unit' ? planUnitTestBatches(files, {requirements: repository.unitRequirements})
      : [{files}];
    let failed=false;
    for (const batch of batches) {
      // Native tests are never silently counted as passing on a local host
      // without the dedicated, source-pinned CI prerequisites.
      if (kind==='unit' && batch.required.some(id=>id.startsWith('native-'))
          && process.env.GITHUB_ACTIONS!=='true') {
        console.error('Native unit checks require the selected GitHub Actions prerequisites: '
          +batch.files.join(', '));
        failed=true;
        continue;
      }
      const args=kind==='unit' ? ['--test','--test-concurrency=2',...batch.files,...forwarded]
        : ['node_modules/@playwright/test/cli.js','test',...batch.files,'--workers=1',...forwarded];
      const result=spawnSync(process.execPath,args,{cwd:repository.root,stdio:'inherit',shell:false});
      if (result.error) throw result.error;
      if (result.status!==0) failed=true;
    }
    process.exitCode=failed?1:0;
    }
  }
}
