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
echo "Filtering an isolated mirror; no source refs are changed."
node tools/git-history-dryrun.mjs rewrite >"$WORKDIR/evidence/filter-repo.log" 2>&1
git --git-dir="$WORKDIR/filtered.git" repack -a -d
rm "$WORKDIR/filtered.git/objects/info/alternates"
git --git-dir="$WORKDIR/filtered.git" reflog expire --expire=now --all
git --git-dir="$WORKDIR/filtered.git" gc --prune=now
git --git-dir="$WORKDIR/filtered.git" fsck --full --no-reflogs --no-progress >"$WORKDIR/evidence/filtered-fsck.txt" 2>&1
git --git-dir="$WORKDIR/filtered.git" for-each-ref --format='%(refname)%09%(objectname)' >"$WORKDIR/evidence/filtered-refs.tsv"
git --git-dir="$WORKDIR/filtered.git" count-objects -vH >"$WORKDIR/evidence/filtered-count-objects.txt"
du -sb "$WORKDIR/filtered.git/objects" | cut -f1 >"$WORKDIR/evidence/filtered-objects-bytes.txt"
echo "Comparing original and filtered refs and exact trees."
node tools/git-history-dryrun.mjs summarize
echo "DONE: $(date -u +%FT%TZ); no remote refs altered" >>"$WORKDIR/evidence/status.txt"
