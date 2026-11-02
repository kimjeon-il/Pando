// Read-only comparison of an original repository and an isolated filtered copy.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteHistory } from './library-history.mjs';

const defaultPrefix = 'assets/data/terrain/v0.12.0/';
function git(repo, args, required = true) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error) throw result.error;
  if (required && result.status !== 0) throw Error(`Git audit failed: ${result.stderr}`);
  return result;
}
function refs(repo) {
  return Object.fromEntries(git(repo, ['for-each-ref', '--format=%(refname)%09%(objectname)']).stdout.trim().split('\n')
    .filter(Boolean).map(line => line.split('\t')));
}

export function summarizeHistoryAudit({ original, filtered, repo, workflowCommit = null,
  obsoletePath = defaultPrefix + 'manifest.json', obsoletePrefix = defaultPrefix, beforeBytes, afterBytes }) {
  if (!original || !filtered || !repo || !Number.isSafeInteger(beforeBytes) || beforeBytes < 0 || !Number.isSafeInteger(afterBytes) || afterBytes < 0)
    throw Error('Explicit audit repositories and object sizes required');
  const old = refs(original), current = refs(filtered), branches = [], pull = [];
  for (const [ref, sha] of Object.entries(old).sort(([a], [b]) => a.localeCompare(b))) {
    const obsolete = () => git(original, ['cat-file', '-e', `${ref}:${obsoletePath}`], false).status === 0;
    if (ref.startsWith('refs/heads/')) {
      const a = git(original, ['rev-parse', `${ref}^{tree}`]).stdout.trim();
      const b = current[ref] ? git(filtered, ['rev-parse', `${ref}^{tree}`]).stdout.trim() : null;
      branches.push({ref, original_sha:sha, rewritten_sha:current[ref] || null, original_tree:a, rewritten_tree:b,
        tree_identical:a === b, obsolete_on_tip:obsolete()});
    } else if (ref.startsWith('refs/pull/')) pull.push({ref, sha, obsolete_on_tip:obsolete(), preserved_locally:Boolean(current[ref])});
  }
  const unclean = Boolean(git(filtered, ['log', '--all', '--format=%H', '--', obsoletePrefix]).stdout.trim());
  return {repo, timestamp_utc:new Date().toISOString(), github_workflow_commit:workflowCommit,
    original_main:old['refs/heads/main'] || null, rewritten_main:current['refs/heads/main'] || null,
    original_object_bytes:beforeBytes, filtered_object_bytes:afterBytes, nominal_repacked_difference_bytes:beforeBytes-afterBytes,
    branch_count:branches.length, preserved_branch_tip_trees:branches.filter(row=>row.tree_identical).length,
    changed_branch_tip_trees:branches.filter(row=>!row.tree_identical), branches, pull_ref_count:pull.length,
    pull_refs_with_obsolete_path_on_tip:pull.filter(row=>row.obsolete_on_tip).length,
    pull_refs_missing_in_filtered_copy:pull.filter(row=>!row.preserved_locally),
    first_25_obsolete_pull_refs:pull.filter(row=>row.obsolete_on_tip).slice(0,25).map(row=>row.ref),
    missing_refs:Object.keys(old).filter(ref=>!current[ref]).sort(), obsolete_path_remains_in_filtered_history:unclean,
    safe_to_force_push_existing_github_repo_for_storage_reduction:false,
    note:'Read-only local comparison only. GitHub-managed PR refs remain on the server; measured difference includes repacking/GC, not guaranteed remote savings.'};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = process.env.AUDIT_DIR;
    if (!root) throw Error('AUDIT_DIR is required');
    const original = join(root, 'original.git'), filtered = join(root, 'filtered.git'), evidence = join(root, 'evidence');
    if (process.argv[2] === 'rewrite' && process.argv.length === 3) {
      await rewriteHistory({source:original, target:filtered, manifest:{paths:[], logicalPaths:[], excludedPrefixes:[defaultPrefix]}});
    } else if (process.argv[2] === 'summarize' && process.argv.length === 3) {
      const summary = summarizeHistoryAudit({original, filtered, repo:process.env.GITHUB_REPOSITORY,
        workflowCommit:process.env.GITHUB_SHA || null, beforeBytes:Number(readFileSync(join(evidence,'original-objects-bytes.txt'),'utf8').trim()),
        afterBytes:Number(readFileSync(join(evidence,'filtered-objects-bytes.txt'),'utf8').trim())});
      writeFileSync(join(evidence,'summary.json'), JSON.stringify(summary,null,2)+'\n', {flag:'wx'});
      const {branches,...brief}=summary;console.log(JSON.stringify(brief,null,2));
      if (!summary.branch_count || !summary.pull_ref_count || summary.missing_refs.length || summary.obsolete_path_remains_in_filtered_history)
        throw Error('Filtered simulation failed reference or old-path consistency checks');
    } else throw Error('Expected rewrite or summarize');
  } catch (error) { console.error('git-history-dryrun: '+error.message); process.exitCode=1; }
}
