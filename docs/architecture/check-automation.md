# Application check automation

The canonical application inventory is scripts/contracts/application-checks.json. scripts/plan-application-checks.mjs discovers tests and selects their consumers; scripts/run-application-checks.mjs executes that plan on Windows and CI. Product expectations are authored independently and never rewritten by this system.

## Commands

- pnpm check:affected --list lists selected checks and reasons without executing them. On Windows, pnpm.cmd may be used.
- pnpm check:affected executes selected checks. Any failed or blocked application check returns nonzero.
- --base REF replaces origin/main as the comparison baseline.
- --output PATH writes JSON evidence; its parent directory must exist.
- --group ID[,ID] explicitly selects catalog groups, including their prerequisites. This is for focused/manual diagnosis, not the default affected path.

Local changes include commits after merge-base with the selected base, staged and unstaged edits independently, and non-ignored untracked files. CI push uses before/head; PR uses merge-base/head. Missing comparison history fails CHECK_HISTORY instead of checking only the last commit. Local use does not auto-fetch; CI can fetch a missing explicit SHA. Ignored build outputs are not inputs.

## Ownership and registration

Test patterns are evaluated in catalog order; the first matching family owns a test. Existing root unit-test patterns discover new tests automatically. Browser families declare the product feature inputs that cannot be inferred from HTTP calls. Unmatched tests, missing exact references, invalid commands or cyclic prerequisites fail discovery. Add new feature families explicitly rather than adding a catch-all browser exemption.

Static ESM, re-exports, fixed dynamic imports, classic Worker scripts and known runtime asset identities feed the dependency graph. Command argv scripts and prerequisites are inferred roots too. Queries do not change file identity. URL helpers whose base is supplied by the app and source files relocated by app staging have explicit runtime-base contracts. Fixture snapshots are immutable data leaves; directory inputs preserve their consumers. Merely computing a script directory does not consume every sibling file.

A renamed module follows current imports. A removed dependency must be removed from current callers and catalog references in the same change. This is check selection, not a proof of statement coverage or a way to infer intended behavior.

## Execution and CI

Prerequisites run before consumers. Identical commands share results only within the same prerequisite context, so test-fixture and map-data staging are each verified after their own stage operation. Staging writes only generated output; validation uses --check and never regenerates tracked sources or updates expectations. Current generated assets and shared Core are required before browser workflows.

Application Architecture owns automatic PR/main application checks. P3 runs the same command on work-branch/artifact-result SHAs after existing P2 ordering. UI, place and reference-image workflows remain explicit manual entrypoints without copied automatic test lists. Manual default Application Architecture covers all automatic groups; focused scopes and P1/P3 manual choices remain explicit. P2 auto dispatch remains affected-only.

Native C++ and GIS Python retain their existing workflows. They appear as external requirements in the plan and execution evidence, with not-executed-by-application-runner status. An application pass does not certify native or Python execution. No hooks, save watcher, publishing or branch protection configuration is installed.
