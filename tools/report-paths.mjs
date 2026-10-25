import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hydrateReports, libraryCheckout, libraryReportRoot, safeChild } from './library-data.mjs';
import { REPORT_SUBJECTS } from './library-report-layout.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
export function reportPath(target, { root = repo, access } = {}) {
  if (!['read', 'write'].includes(access)) throw Error('Report access must be read or write');
  if (!target.startsWith('reports/')) throw Error(`Not a report path: ${target}`);
  const output = safeChild(libraryReportRoot(root), target.slice('reports/'.length));
  const subject = target.slice(8).split('/')[0];
  if (!Object.hasOwn(REPORT_SUBJECTS, subject) && !['README.md', 'TEMPLATE.md'].includes(subject)) throw Error(`Use a canonical report subject: ${target}`);
  if (existsSync(resolve(libraryCheckout(root), '.git'))) return hydrateReports({ root, path: target.slice('reports/'.length), access });
  return output;
}


/** Convert an explicit legacy reports/ input to the canonical library path.
 * Non-report local source paths remain untouched; siblings preserve the source basename.
 */
export function reportArgument(value,{access,siblings=false,root=repo}={}){
  if(value==null)return null;
  const text=String(value),source=resolve(text),reportsRoot=resolve(root,'reports');
  const rel=relative(reportsRoot,source);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))return text;
  const normalized=rel.replaceAll('\\','/');
  if(siblings&&dirname(normalized)!=='.'){
    const directory=reportPath('reports/'+dirname(normalized),{root,access});
    return join(directory,basename(normalized));
  }
  return reportPath('reports/'+normalized,{root,access});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(reportPath(process.argv[2], { root: process.argv[4] || repo, access: process.argv[3] }));
