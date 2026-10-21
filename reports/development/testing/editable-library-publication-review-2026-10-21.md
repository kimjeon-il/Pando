# Independent library publication code review

> Report ID: `UI-LIBRARY-PUBLISH-REVIEW-20261021` · Status: `changes-requested` · Geometry application: `not-applicable` · Indexed: 2026-10-21  
> Source revision: `4f35c345e0707c44e383cca027e119207f93259c` plus uncommitted publication implementation in permanent `work/ui`  
> Scope: `.superpowers/sdd/2026-10-21-editable-library/review-publication.patch`, implementation ledger, current publication code and direct consumers. Editor/native findings are in the separate editor/native review.

## Verdict and evidence

Changes requested: four Important findings, no Critical finding. Reviewed pinned private checkout/raw content hashes, generators, release assembly, both Actions workflows, public channel/cache handling, immutable Worker asset generation, and dynamic world-count checks. The existing nine publication test files (20 passing tests) and output checks were not rerun. The declared local results remain implementation evidence, not live GitHub or native WebView proof.

The implementation correctly pins the private Git commit and exact manifest bytes, hashes source objects, stages only public generated data, disables persisted credentials on the private checkout, keeps executable asset revisions separate, and rejects reachable invalid channel metadata rather than silently selecting an older cached release. Publication requires an explicit dispatch. Dynamic count checks generally continue to tie derived counts to the selected source and retain hash, binary-header, unique-ID, and geometry checks.

## Important findings

### P1. Real current-world snapshot identity cannot be materialized

- Reviewed location: `tools/prepare-library-publication.mjs:61-62`; downstream consumer `tools/territorial-current-world.mjs:9`.
- Trigger: publish the seeded schema-2 catalog, including an ordinary name-only edit.
- The materializer requires snapshot IDs to match `/^[a-z0-9][a-z0-9_-]*$/` and writes `snapshots/<snapshot.id>.json`. The actual bundled current-world snapshot ID is `world:natural-earth-5.1.1`, so it rejects with `Unsafe snapshot identity`. Moreover, downstream generation reads `snapshots/current-world.json`; source identity and filename are separate domains.
- Narrow evidence: reading the actual generated index returned `world:natural-earth-5.1.1 => false` and `pilot-1991 => true` for that regex. Current publication tests manufacture an ID `current-world`, masking the real contract.
- Required change: preserve snapshot identities and map to the canonical filename or have consumers locate the current snapshot through an explicit canonical role. Do not rename data identities merely to fit filenames. Add a materialize-to-current-world regression using the actual current snapshot contract.

### P2. A second data publication removes prior immutable releases from deployed Pages

- Reviewed location: `.github/workflows/library-publish.yml:95-96`, upload at `:124`.
- Trigger: publish release B while an open viewer remains pinned to release A and has not cached every lazy asset/Worker manifest.
- The Pages stage starts with committed code and receives only the freshly assembled release B. The data-branch checkout later preserves A and B in Git, but its retained A directory is never copied into the Pages artifact. Deploy Pages replaces the site with that artifact, so A URLs disappear even though viewers/Workers intentionally pin their selected revision. A subsequent regular code deployment happens to copy all data-branch releases, but this does not repair the missing interval after a data-only deployment.
- Evidence: workflow step/dataflow inspection, no deployment performed.
- Required change: stage the accumulated verified immutable releases from the data branch together with the new release before uploading Pages. Preserve the old bytes, verify the new current pointer, and add a two-release staging regression that checks both A and B paths.

### P3. Shared Worker publication lookup breaks the small-project native shell

- Reviewed location: `assets/js/workers/gpu-mesh-worker.js:27`, `:42`, `:101`.
- Trigger: start the native small-project resource profile and request `geometry.prepare`.
- `polygonPreparation` now resolves the public data channel before reaching the existing `resourceProfile === 'small-project' ? null` manifest path. The shell's real network guard rejects `/assets/data/library-channel/current.json` in this mode. That rejection poisons `polygonPreparation`, which every `geometry.prepare` operation awaits. Previously this mode used its local source and did not request the public catalog.
- Narrow reproduction used the actual `installNetworkGuard` and `resolvePublicDataChannel` with small-project metadata. Result: `공개 라이브러리 연결이 끊겼고 검증된 저장 판본이 없습니다.`; cause: `Prototype resource request blocked: http://tauri.localhost/assets/data/library-channel/current.json`.
- Required change: keep native/local resource profiles on their explicit bundled data source and apply public-channel discovery only to its intended public execution path. Do not reinterpret a blocked request as a generally recoverable invalid-publication fallback. Add a shared Worker/native small-project initialization regression.

### P4. Name and flag edits of current countries do not reach the generated public project

- Reviewed integration locations: `tools/territorial-current-world.mjs:16`; `tools/historical-world-timeline.mjs:83-85` (current-source branch), compared with `:107-111` (non-current branch).
- Trigger: edit `state:KOR`'s Korean name or default flag in the source editor, save/sync, and explicitly publish.
- The editable source stores those fields in `entity.names` and `entity.metadata.defaultFlagDataUrl`. `buildCurrentWorld` emits the old `sourceInfo.featureProperties` instead. The historical project compiler creates the current country's identity from that built-in feature and only appends `historicalTimeline`; it never projects the edited name or flag. Its non-current-source branch does correctly read both fields. Consequently the released library chunk can contain the edit while the public map's generated current-country identity still shows the old name/flag.
- Evidence: complete source-field-to-public-identity code path inspection. A one-country compiler probe was rejected by the preexisting built-in parent classification requirement and was not treated as workflow evidence. A full-source probe was attempted but its final output was not captured; no runtime success is claimed.
- Required change: project editable current-source display fields through the canonical existing generator while preserving original source feature provenance and project identity. Add a current-country name/flag regression against the resulting generated project identity.

## Ruled out and other boundaries

- The preliminary GPU Worker relative-root concern is **not a finding**: `scripts/lib/worker-assets.mjs` rewrites literal non-code URLs from source locations to canonical paths while generating immutable Worker closures. Inferring the runtime root from the original worker path alone was incorrect. A subsequent diagnostic expecting the old literal did not match after concurrent worker changes; it was not counted as passing evidence.
- The private-source materializer compares only selected metadata fields, but the four findings above are the concrete blockers prioritized in this review. No claim is made that every indexed metadata invariant was dynamically exercised.
- Native-first rollout, repository/secret provisioning, `library-data` branch creation, actual workflow execution and live Pages byte verification remain separate authorized rollout work. Their absence is not classified as an implementation defect.
- No credentials, private checkout files, or raw private source files were observed entering the Pages staging closure. No remote operations were performed during this review.
- No historical boundary investigation, screen-space tolerance validation, map data application, or native WebView execution was performed. No historical correctness or 0.5 CSS px success is claimed.
- Concurrent implementation fixes began during this review. Findings record the reviewed pre-fix code and need explicit follow-up evidence before being marked resolved.

## Revision

Initial publication-scope review, 2026-10-21. Product code and preexisting artifacts were not modified by the reviewer; only this report, its index entry, and the SDD handoff pointer were written.
