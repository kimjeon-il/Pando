#!/usr/bin/env bash
set -Eeuo pipefail
WORKDIR="$RUNNER_TEMP/pando-git-history-dryrun"
mkdir -p "$WORKDIR/evidence"
export AUDIT_DIR="$WORKDIR"
export GIT_TERMINAL_PROMPT=0
echo "START: $(date -u +%FT%TZ)" >"$WORKDIR/evidence/status.txt"
echo "Cloning all advertised refs; no remote writes..."
git clone --quiet --mirror "https://github.com/$GITHUB_REPOSITORY.git" "$WORKDIR/original.git"
git --git-dir="$WORKDIR/original.git" fsck --full --no-reflogs --no-progress >"$WORKDIR/evidence/original-fsck.txt" 2>&1
git --git-dir="$WORKDIR/original.git" for-each-ref --format='%(refname)%09%(objectname)' >"$WORKDIR/evidence/original-refs.tsv"
git --git-dir="$WORKDIR/original.git" count-objects -vH >"$WORKDIR/evidence/original-count-objects.txt"
du -sb "$WORKDIR/original.git/objects" | cut -f1 >"$WORKDIR/evidence/original-objects-bytes.txt"
echo "Filtering separate mirror only."
cp -a "$WORKDIR/original.git" "$WORKDIR/filtered.git"
(
 cd "$WORKDIR/filtered.git"
 "$HISTORY_VENV/bin/git-filter-repo" --force --path assets/data/terrain/v0.12.0/ --invert-paths \
    >"$WORKDIR/evidence/filter-repo.log" 2>&1
)
git --git-dir="$WORKDIR/filtered.git" reflog expire --expire=now --all
git --git-dir="$WORKDIR/filtered.git" gc --prune=now
git --git-dir="$WORKDIR/filtered.git" fsck --full --no-reflogs --no-progress >"$WORKDIR/evidence/filtered-fsck.txt" 2>&1
git --git-dir="$WORKDIR/filtered.git" for-each-ref --format='%(refname)%09%(objectname)' >"$WORKDIR/evidence/filtered-refs.tsv"
git --git-dir="$WORKDIR/filtered.git" count-objects -vH >"$WORKDIR/evidence/filtered-count-objects.txt"
du -sb "$WORKDIR/filtered.git/objects" | cut -f1 >"$WORKDIR/evidence/filtered-objects-bytes.txt"
echo "Comparing original and filtered refs and exact trees."
python3 - <<'PY'
from pathlib import Path
import json, os, subprocess, datetime
root=Path(os.environ['AUDIT_DIR'])
ev=root/'evidence'
orig=root/'original.git'
filt=root/'filtered.git'
path='assets/data/terrain/v0.12.0/manifest.json'
def git(repo,*args,ok=True):
    p=subprocess.run(['git','--git-dir='+str(repo),*args],capture_output=True,text=True)
    if ok and p.returncode: raise RuntimeError(f'git {args}: {p.stderr[:500]}')
    return p
def refs(name):
    return dict(line.split('\t',1) for line in (ev/name).read_text().splitlines() if line.strip())
old=refs('original-refs.tsv')
new=refs('filtered-refs.tsv')
branches=[]
pr=[]
for ref,sha in sorted(old.items()):
    if ref.startswith('refs/heads/'):
        a=git(orig,'rev-parse',ref+'^{tree}').stdout.strip()
        b=git(filt,'rev-parse',ref+'^{tree}').stdout.strip() if ref in new else None
        branches.append({'ref':ref,'original_sha':sha,'rewritten_sha':new.get(ref),
                         'original_tree':a,'rewritten_tree':b,'tree_identical':a==b,
                         'obsolete_on_tip':git(orig,'cat-file','-e',ref+':'+path,ok=False).returncode==0})
    if ref.startswith('refs/pull/'):
        pr.append({'ref':ref,'sha':sha,
                   'obsolete_on_tip':git(orig,'cat-file','-e',ref+':'+path,ok=False).returncode==0,
                   'preserved_locally':ref in new})
unclean=git(filt,'log','--all','--format=%H','--','assets/data/terrain/v0.12.0/').stdout.strip()
before=int((ev/'original-objects-bytes.txt').read_text())
after=int((ev/'filtered-objects-bytes.txt').read_text())
result={
 'repo':os.environ['GITHUB_REPOSITORY'],
 'timestamp_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'github_workflow_commit':os.environ.get('GITHUB_SHA'),
 'original_main':old.get('refs/heads/main'),
 'rewritten_main':new.get('refs/heads/main'),
 'original_object_bytes':before,'filtered_object_bytes':after,
 'nominal_repacked_difference_bytes':before-after,
 'branch_count':len(branches),'preserved_branch_tip_trees':sum(x['tree_identical'] for x in branches),
 'changed_branch_tip_trees':[x for x in branches if not x['tree_identical']],
 'branches':branches,'pull_ref_count':len(pr),
 'pull_refs_with_obsolete_path_on_tip':sum(x['obsolete_on_tip'] for x in pr),
 'pull_refs_missing_in_filtered_copy':[x for x in pr if not x['preserved_locally']],
 'first_25_obsolete_pull_refs':[x['ref'] for x in pr if x['obsolete_on_tip']][:25],
 'missing_refs':sorted(set(old)-set(new)),
 'obsolete_path_remains_in_filtered_history':bool(unclean),
 'safe_to_force_push_existing_github_repo_for_storage_reduction':False,
 'note':'Read-only local comparison only. GitHub-managed PR refs remain on the server; measured difference includes repacking/GC, not guaranteed remote savings.'
}
(ev/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='branches'},indent=2))
if not (branches and pr and not result['missing_refs'] and not unclean):
    raise SystemExit('Filtered simulation failed reference or old-path consistency checks')
PY
echo "DONE: $(date -u +%FT%TZ); no remote refs altered" >>"$WORKDIR/evidence/status.txt"
