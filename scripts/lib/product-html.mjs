// UI fragments are source; the two startup HTML files are generated outputs.
export function renderProductHtml(readSource) {
  return Object.fromEntries(['web','editor'].map(mode => {
    const template=readSource(`ui/templates/${mode}.html`).replaceAll('\r\n','\n');
    const omitted=new Set(mode==='editor'?['map-terrain','map-decorations-basic']:['map-decorations-advanced']);
    const expand=source=>source.replace(/<!-- include:([a-z-]+) -->/g,(_match,name)=>omitted.has(name)?'':expand(readSource(`ui/fragments/${name}.html`).replaceAll('\r\n','\n').trim()));
    const html=expand(template);
    if (/<!-- include:/.test(html)) throw new Error('Unresolved UI fragment');
    return [mode,html.replace('<!DOCTYPE html>','<!DOCTYPE html>\n<!-- Generated from ui/templates and ui/fragments by scripts/generate-build-metadata.mjs. -->')];
  }));
}
