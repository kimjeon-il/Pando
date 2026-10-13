# Git history size audit — 2026-10-13

**Status:** Read-only history simulation in progress. No GitHub ref force-push.

## Baseline
- Repo: `kimjeon-il/Pando`, main `cacd5b70e4dd41b2946a398f78c2d90d859090f1`.
- Historical unused terrain: `assets/data/terrain/v0.12.0/`, 335 files / 374,094,147 bytes at old PR tips.
- There are 10 ordinary branches, no tags, and 103 GitHub-managed `refs/pull/*` refs.
- PRs 1, 10, 25, 40, 60 and 80 still contain the old 335-file directory in their tip trees; PRs 100 and 102 do not.
- An earlier isolated local Web mirror reported 1,356,546,173 bytes of Git objects before and 829,110,766 after filtering + GC. The 527,435,407-byte difference includes compression and unreachable objects; it is not a measured GitHub quota saving.

## GitHub limit
[GitHub documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) states that PR refs may keep old Git objects reachable, and GitHub Support will not dereference PR objects merely for **non-sensitive** large file removal. Forcing ordinary branch refs would invalidate existing SHAs without reliably reducing this repository's reported size.

## Safe simulation
The read-only workflow at `.github/workflows/git-history-size-audit.yml` mirrors all advertised refs into an Actions temporary directory, copies it, runs `git-filter-repo 2.47.0` only on the copy, checks Git fsck, counts PR refs and compares all branch-tip tree hashes. It uploads a 30-day JSON/text evidence artifact. Workflow permissions are **contents: read**; it cannot update remote refs.

**No existing branch, tag, release, app file, Pages deployment or current GIS data is modified.**

## Proposed actual size-reduction route
Use a newly created clean repository containing the verified rewritten history and current Web/Native trees. Keep the existing repository as a recoverable archive, and cut over the Pages deployment only after parity/build tests and URL implications are resolved. The installed GitHub connector does not expose the action to create a new repository; it is not yet possible to complete that migration entirely from this chat.

Final audit sizes, reference checks and recommended next step will be recorded after the Actions run.
