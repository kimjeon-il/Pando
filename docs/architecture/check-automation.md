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

Groups may declare `includes` with other group IDs. Explicit group requests expand this relation once before selection; missing groups and inclusion cycles fail discovery. Tests retain one canonical owner and the final execution list remains unique. Viewer and rendering requests both include the canonical `viewer-startup` group, whose single cold/warm scenario checks engine requests, prepared country/border publication and date return.

Planning prepares only the pinned library archive metadata. The catalog's `metadataOnlyTests` lists individually reviewed unit suites that do not consume real runtime data. A non-browser selection consisting only of these suites omits Viewer payload preparation; commands, explicit native requests and unclassified suites keep runtime preparation. Browser selections always prepare their runtime inputs. Preview planning uses the same pinned Viewer closure and archive content hashes for output fingerprints, reading only required manifests and normalized text inputs; output bytes remain verified by their actual build/runtime consumers.

On ordinary pushes, Viewer preview delegates application contracts to an unfiltered automatic Application Architecture trigger for the same branch. Other branches and explicit dispatches retain their own invocation. The decision reads the workflow's current trigger declaration rather than maintaining a second branch list.

Static ESM, re-exports, fixed dynamic imports, classic Worker scripts and known runtime asset identities feed the dependency graph. Command argv scripts and prerequisites are inferred roots too. Queries do not change file identity. URL helpers whose base is supplied by the app and source files relocated by app staging have explicit runtime-base contracts. Fixture snapshots are immutable data leaves; directory inputs preserve their consumers. Merely computing a script directory does not consume every sibling file.

A renamed module follows current imports. A removed dependency must be removed from current callers and catalog references in the same change. This is check selection, not a proof of statement coverage or a way to infer intended behavior.

## Execution and CI

Prerequisites run before consumers. Identical commands share results only within the same prerequisite context, so test-fixture and map-data staging are each verified after their own stage operation. Staging writes only generated output; validation uses --check and never regenerates tracked sources or updates expectations. Current generated assets and shared Core are required before browser workflows.

Application Architecture owns automatic PR/main application checks. P3 runs the same command on work-branch/artifact-result SHAs after existing P2 ordering. UI and place workflows remain explicit manual entrypoints without copied automatic test lists. Map analysis and ordinary import use the same selector; the Node OCR/Pillow runtime group explicitly requires its existing local environment. Manual default Application Architecture covers all automatic groups; focused scopes and P1/P3 manual choices remain explicit. P2 auto dispatch remains affected-only.

Native C++ builds and GIS source checks are separate from the general application runner. `.github/workflows/gis-source-p4.yml` runs Node-based source/zero-Python checks on selected pushes and pull requests; its C++ historical geometry scope is manual. The GIS Node migration and native C++ workflows have separate evidence. An application pass does not certify those independent checks, original-data reconstruction or actual device behavior. No hooks, save watcher, publishing or branch protection configuration is installed.

## Workflow ownership and trigger consolidation (2026-11-12)

The exhaustive workflow registry is `scripts/contracts/workflow-inventory.json`.
Its 2026-11-12 baseline partitions 76 workflows into 16 continuous, 41 manual
and 19 historical. Counts are **not** fixed by the registry audit; new/retired
files must be classified explicitly. Manual and historical workflows cannot
acquire automatic events without being promoted and reviewed.

Independent native/GIS source builds, publication, cross-device acceptance,
preview staging, and Pages deployment retain their specialized gates.
18 obsolete one-off or overlapping automatic `push` routes were changed to
opt-in `workflow_dispatch`, retaining their original job bodies for forensic
reproduction. Historical evidence is not a current green check.

The canonical application check runner remains `application-architecture.yml`.
`viewer-preview` discovers its unfiltered branch trigger list and delegates
automatic application checks (including on `work/remote-only`) instead of
duplicating them. The workflow inventory audit is both an early CI preflight
and an affected check group. Full-catalog verification remains opt-in.
