import {frontendTemplates,frontendFragmentRoot} from './frontend-layout.mjs';
// UI fragments are source; the two startup HTML files are generated outputs.
export function renderProductHtml(readSource) {
  return Object.fromEntries(['web','editor'].map(mode => {
    const template=readSource(frontendTemplates[mode]).replaceAll('\r\n','\n');
    const omitted=new Set(mode==='editor'?['map-terrain','map-decorations-basic']:['preferences-statusbar']);
    const expand=source=>source.replace(/<!-- include:([a-z-]+) -->/g,(_match,name)=>omitted.has(name)?'':expand(readSource(`${frontendFragmentRoot}/${name}.html`).replaceAll('\r\n','\n').trim()));
    const html=expand(template);
    if (/<!-- include:/.test(html)) throw new Error('Unresolved UI fragment');
    return [mode,html.replace('<!DOCTYPE html>','<!DOCTYPE html>\n<!-- Generated from product templates and shared frontend fragments. -->')];
  }));
}
