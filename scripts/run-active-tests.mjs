// Run discovered Viewer feature tests; controlled measurements remain manual.
import {spawnSync} from 'node:child_process';
import {loadRepository} from './plan-application-checks.mjs';
import {planUnitTestBatches} from './lib/unit-test-batches.mjs';

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
