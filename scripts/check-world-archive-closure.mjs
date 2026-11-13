// The public Viewer loads pinned library assets externally, never from files
// accidentally committed into the application repository.
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function assertNoTrackedLibraryAssets(paths) {
  if(!Array.isArray(paths)||paths.some(path=>typeof path!=='string'))
    throw Error('Invalid tracked runtime asset inventory');
  if(paths.length)throw Error('Library runtime assets are tracked by the app repository: '+paths.slice(0,8).join(', '));
  return true;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const files=execFileSync('git',['ls-files','--','assets/data'],{cwd:root,encoding:'utf8'}).trim();
  assertNoTrackedLibraryAssets(files?files.split(/\r?\n/):[]);
  console.log(JSON.stringify({ok:true,trackedLibraryAssets:0}));
}
