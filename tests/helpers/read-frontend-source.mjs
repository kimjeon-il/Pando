import {readFileSync} from 'node:fs';

export function readFrontendSources(...names){
  return names.map(name=>{
    if(!/^[a-z0-9-]+$/.test(name))throw new TypeError('Frontend module name is invalid');
    return readFileSync(new URL(`../../shared/frontend/js/modules/${name}.js`,import.meta.url),'utf8');
  }).join('\n')
    .replace(/\(0, dependencies\.[$\w]+\.([$\w]+)\)/g,'$1')
    .replace(/\bdependencies\.[$\w]+\.([$\w]+)/g,'$1')
    .replace(/\(0, dependencies\.([$\w]+)\)/g,'$1')
    .replace(/\bdependencies\./g,'');
}
