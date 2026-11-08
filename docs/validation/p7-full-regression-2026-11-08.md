# P7 consolidation: executed full regression and failure triage

Owner: `work/optimization`; no merge to `main`.
Consolidation count: **616 original historical unit file identities -> 395 active unit suites**.
The 616 original identities are still indexed by the static contract migration gate.

## Full-catalog run actually executed

- GitHub Actions: https://github.com/kimjeon-il/Pando/actions/runs/42436935407
- Tested SHA: `79ff9db63810bcb1b9003793978fddae314bf426`.
- **Overall conclusion: failure.** This is not a passing or complete behavioral validation.
- Static registry/selection job: **success**. No missing original contracts,
  duplicate original identities, stale direct test executable references or invalid
  GIS owner map detected by the registered static audit.
- Selected: **394 direct unit suites**, plus **one USSR Native unit suite through its
  registered native command**, **12 browser specs** (three shards), and **29 command
  groups**.
- Node harness across 26 process batches: **3,471 results: 3,163 passed,
  75 failed, 233 skipped**, 0 cancelled. Skipped cases are not counted as passing.
- Non-browser runner result entries: **66 total: 46 passed, 18 failed, 2 blocked**.
  These entries include command/prerequisite executions and unit process batches,
  so they are not additional individual Node test cases.
- All three browser shards: **failed before executing Playwright test cases**,
  because the Viewer product build prerequisite could not resolve required data.

## Confirmed primary external library data blocker

The application pins external library repo `kimjeon-il/PandoLab-library-data`,
revision `621a5614049b7472a5de6de588eda01cee4983dc`.
The source Git tree at that exact pin contains both:

- `assets/data/places/urban-lifetimes-v1.json`
- `assets/data/builtin-world/display-policy-v1.json`

However, its `archive/index.json` (**SHA
`a9e46e359fdda9ab5cd319611498e3e2d782ee26`**) does not list either
file. The application’s `tools/library-data.mjs` materializes source-pinned
runtime data from archive index entries rather than a loose source checkout.
Consequently both files are absent from mounted runtime data after successful
library preparation. Three browser shards and many unit tests cannot proceed.

**Required remediation:** archive and publish the exact reviewed data files
through the external library’s existing storage workflow, verify source hashes
and index entries, then update the app’s immutable library revision pin in a
separately authorized data integration. Do not suppress Viewer dependency
verification, silently copy non-pinned assets, or discard original evidence.

## Other failure classes from complete logs

| Domain | Observed failures | Follow-up boundary |
| --- | --- | --- |
| Test infrastructure | Transitive group selection, old test expectation of default full dispatch, mismatched native fixture prerequisite, stale historical workflow list, browser shard count and YAML Buffer parsing | Corrected after tested SHA in `cdbc6b4`; requires new CI confirmation |
| Performance/CI ownership | Retired browser/unit filenames still listed in `config/performance-baseline-v1.json` as active suites | Corrected after tested SHA in `e07d71b`; historical, unverified measurement evidence unchanged |
| Viewer/UI | Legacy expectation of `Viewer/Windows` audit phrase despite Viewer-only product | Corrected after tested SHA in `e07d71b` |
| Boundary polygon fixture | Shared synthetic rectangle rejected valid antimeridian wrap | Corrected after tested SHA in `e07d71b` without weakening default non-wrapped rectangle validation |
| Shared-boundary generation | Current builder called `classifyBuiltinCountries` without explicit versioned display policy | Corrected after tested SHA in `e07d71b`; still blocked until archived policy is available |
| Historical territorial and time | Missing prepared data, exact-date vs monthly domain inputs, source geometry / parent relation / period selection mismatches | Open; requires domain-level diagnosis, not CI expectation changes |
| GIS/Native geometry | Production Serbia/Croatia/Moldova river partition failed with `Unable to complete output ring`; historical geometry parity also failed | Open; preserve independent native/source proofs while investigating |
| Core/WASM | One full-document world test rejected year-only `1914` as invalid monthly date; other object contract failures | Open; align raw-source precision and Core input contracts without coercing original evidence |

These observed failures may have different origins (missing source archive material,
old contract assertions and actual regressions). They must not be merged into one
blanket skip or handled by suppressing dependencies.

## Subsequent unverified corrections

- `cdbc6b4adcd34b15eaae996145f8a25ad2678d35`: fixes reverse dependency selection and current runner/native test expectations.
- `e07d71bec5717bc0329307650dc4057631f74a9e`: corrects retained active performance suite references, expands static audit, restores valid dateline fixture, aligns Viewer-only UI audit expectations and supplies explicit display policy to boundary generator.

These commits **have not yet passed the complete suite**. A new full run after
the library archive fix and domain repairs is required before stating success.
