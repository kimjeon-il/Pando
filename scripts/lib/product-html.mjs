// UI fragments are source; the two startup HTML files are generated outputs.
export function renderProductHtml(readSource) {
  return Object.fromEntries(['web','editor'].map(mode => {
    const template=readSource(`ui/templates/${mode}.html`).replaceAll('\r\n','\n');
    const html=template.replace(/<!-- include:([a-z-]+) -->/g,(_match,name)=>readSource(`ui/fragments/${name}.html`).replaceAll('\r\n','\n').trim());
    if (/<!-- include:/.test(html)) throw new Error('Unresolved UI fragment');
    return [mode,html.replace('<!DOCTYPE html>','<!DOCTYPE html>\n<!-- Generated from ui/templates and ui/fragments by scripts/generate-build-metadata.mjs. -->')];
  }));
}
