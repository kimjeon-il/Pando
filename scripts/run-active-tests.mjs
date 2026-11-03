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
    const args=kind==='unit'?
      ['--test','--test-concurrency=2',...files,...process.argv.slice(3)]:
      ['node_modules/@playwright/test/cli.js','test',...files,'--workers=1',...process.argv.slice(3)];
    const result=spawnSync(process.execPath,args,{cwd:repository.root,stdio:'inherit'});
    if(result.error)throw result.error;
    process.exitCode=result.status??1;
  }
}
