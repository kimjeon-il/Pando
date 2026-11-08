import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildFrontendIndex} from '../../scripts/lib/frontend-layout.mjs';

export function readFrontendSources(...names){
  return names.map(name=>{
    if(!/^[a-z0-9-]+$/.test(name))throw new TypeError('Frontend module name is invalid');
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const entry=buildFrontendIndex(root).get(`assets/js/modules/${name}.js`);
    if(!entry)throw new Error('Unknown frontend module: '+name);
    return readFileSync(new URL('../../'+entry.sourcePath,import.meta.url),'utf8');
  }).join('\n')
    .replace(/\(0, dependencies\.[$\w]+\.([$\w]+)\)/g,'$1')
    .replace(/\bdependencies\.[$\w]+\.([$\w]+)/g,'$1')
    .replace(/\(0, dependencies\.([$\w]+)\)/g,'$1')
    .replace(/\bdependencies\./g,'');
}
