import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {libraryCheckout} from './data/library-context.mjs';
const root=process.cwd(),checkout=libraryCheckout(root);
const git=(args)=>execFileSync('git',args,{cwd:checkout,encoding:'utf8',maxBuffer:32*1024*1024}).trim();
const pinned=JSON.parse(readFileSync('config/library-data.json','utf8')).revision;
const expected='b355236e73503720e38d40b1eba03224f7ab033b';
const remote=git(['ls-remote','origin','refs/heads/work/ui']).split(/\s+/)[0];
if(remote!==expected)throw Error('Data branch changed; review the new head before reconciling');
git(['fetch','--no-tags','--filter=blob:none','origin',remote]);
const base=git(['merge-base',pinned,remote]);
const index=ref=>JSON.parse(git(['show',ref+':archive/index.json']));
const b=index(base),r=index(remote),p=index(pinned);
const paths=[...new Set([...Object.keys(b.files),...Object.keys(r.files)])];
const changed=paths.filter(path=>b.files[path]?.sha256!==r.files[path]?.sha256);
const rows=changed.map(path=>({path,before:b.files[path]?.sha256??null,remote:r.files[path]?.sha256??null,pinned:p.files[path]?.sha256??null,
  incorporated:r.files[path]?.sha256===p.files[path]?.sha256}));
console.log('UI_LIBRARY_DIVERGENCE '+JSON.stringify({base,pinned,remote,changes:rows}));
writeFileSync(process.env.RUNNER_TEMP+'/ui-data-history.json',JSON.stringify({base,pinned,remote,changes:rows},null,2)+'\n');
