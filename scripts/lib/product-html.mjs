import {frontendTemplates,frontendFragmentRoot} from './frontend-layout.mjs';
// UI fragments are source; the Viewer/Windows reviewer share one HTML template.
export function renderProductHtml(readSource) {
  return Object.fromEntries(['web'].map(mode => {
    const template=readSource(frontendTemplates[mode]).replaceAll('\r\n','\n');
    const expand=source=>source.replace(/<!-- include:([a-z-]+) -->/g,(_match,name)=>expand(readSource(`${frontendFragmentRoot}/${name}.html`).replaceAll('\r\n','\n').trim()));
    // Resolve the shared brand at build time, before asset closure and revisioning.
    const html=expand(template.replace(/<link rel="icon" href="data:,"\s*\/?>/g,'<!-- include:brand-icons -->'));
    if (/<!-- include:/.test(html)) throw new Error('Unresolved UI fragment');
    return [mode,html.replace('<!DOCTYPE html>','<!DOCTYPE html>\n<!-- Generated from product templates and shared frontend fragments. -->')];
  }));
}
