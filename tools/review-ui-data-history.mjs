import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
if(process.argv.includes('--integrate')){
  const divergent=rows.filter(row=>!row.incorporated);
  // Reviewed in CI 42531100662: 327 of the 351 old UI changes already have
  // exactly the pinned bytes. The remaining 24 are superseded generated
  // runtime editions, never source countries, originals or report edits.
  // Keep the already-approved code/data pairing, not an obsolete 2026-10-30
  // runtime. A real two-parent commit retains every byte in both histories.
  const review=createHash('sha256').update(JSON.stringify(divergent)).digest('hex');
  if(pinned!=='c370d4f95e27c6b777239de58d3170171d7379db'
    ||divergent.length!==24||review!=='9131e7c49551da34812abfff04b48eefe03eb7ee9077d211d841722bb1b4f902')
    throw Error('Archive divergence differs from the explicitly reviewed input');
  if(git(['status','--porcelain'])||git(['rev-parse','HEAD'])!==pinned)
    throw Error('Preserve unexpected archive work; reconciliation requires the clean pinned checkout');
  const tree=git(['rev-parse',pinned+'^{tree}']);
  const merge=git(['-c','user.name=Pando library publisher','-c','user.email=library-publisher@users.noreply.github.com',
    'commit-tree',tree,'-p',pinned,'-p',remote,'-m','Integrate reviewed current runtime into UI; preserve October UI editions in second-parent history']);
  git(['merge','--ff-only',merge]);
  git(['merge-base','--is-ancestor',remote,'HEAD']);
  git(['merge-base','--is-ancestor',pinned,'HEAD']);
  if(git(['rev-parse','HEAD^{tree}'])!==tree)throw Error('Reconciliation changed the pinned runtime tree');
  console.log('UI_LIBRARY_RECONCILED '+JSON.stringify({merge,pinned,previousUi:remote,tree}));
}
