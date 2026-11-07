// Local Git/report test ports: never contact the real library checkout or origin.
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';

export function reportFixtureGit(cwd,...args) {
  return execFileSync('git',[
    '-c','maintenance.auto=false',
    '-c','gc.auto=0',
    '-c','core.autocrlf=false',
    ...args,
  ],{cwd,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
}

export function writeReportFixtureFile(root,path,bytes) {
  const target=join(root,path);
  mkdirSync(dirname(target),{recursive:true});
  writeFileSync(target,bytes);
}
