import {frontendTemplates,frontendFragmentRoot} from './frontend-layout.mjs';
// Viewer is the sole published HTML product. Keep the same 'web' build contract.
export function renderProductHtml(readSource) {
  const template=readSource(frontendTemplates.web).replaceAll('\r\n','\n');
  const expand=source=>source.replace(/<!-- include:([a-z-]+) -->/g,(_match,name)=>expand(readSource(`${frontendFragmentRoot}/${name}.html`).replaceAll('\r\n','\n').trim()));
  // Resolve shared brand at build time before asset closure and revisioning.
  const html=expand(template.replace(/<link rel="icon" href="data:,"\s*\/?>/g,'<!-- include:brand-icons -->'));
  if (/<!-- include:/.test(html)) throw new Error('Unresolved UI fragment');
  return {web:html.replace('<!DOCTYPE html>','<!DOCTYPE html>\n<!-- Generated from product templates and shared frontend fragments. -->')};
}
