# Pando remote-only development (work/remote-only)

Baseline: main commit `5b636f814f397cd0d8b2a64c8e7ddfab1c02c51e` (2026-11-04).
This branch is an isolated migration candidate. Do not merge into main or deploy
GitHub Pages without the user's separate approval.

## Open without installing developer tools on Windows

Open [work/remote-only in GitHub Codespaces](https://codespaces.new/kimjeon-il/Pando/tree/work/remote-only?quickstart=1).
This creates a remote Linux container, not a local folder. The initial
`.devcontainer/setup-remote.sh` checks the pinned Node major and installs
the pinned pnpm dependencies into the Codespace only. Its command is not
`pnpm deps:prepare`: that command intentionally expects a separately
activated Windows shared cache.

The startup script runs the Viewer on private forwarded port 4173, using the
current branch and its pinned library-data revision. Geographic materialization
can delay readiness; view `/tmp/pando-remote-only-preview.log` if necessary.
Do not change the forwarded port's visibility to public.

Use the Codespaces terminal for source edits and small JavaScript checks:

```bash
node scripts/remote-only-doctor.mjs
bash .devcontainer/pnpm.sh lint
node --test tests/unit/remote-only-contract.test.mjs
```

Do not run local native preparation, CMake, Emscripten, LibTorch or GIS SDK
installation. `scripts/prepare-native-test-tools.mjs` rejects those native
preparations on this branch outside GitHub Actions, including when invoked
from a Windows checkout.

## Builds and verification are owned by CI

- P1 `.github/workflows/remote-development-p1.yml`: source-aware UI,
  C++, GIS, WASM and Windows reviewer jobs. This branch is a push target.
  Explicit Windows `native` or `native-tests` runs use the Actions workflow.
- P2 `.github/workflows/generated-artifacts-p2.yml`: regenerate only
  changed source-bound WASM/data families and publish with a guarded
  work-branch fast-forward, not to main. Do not use `all` casually.
- P3 `.github/workflows/remote-preview-p3.yml`: browser evidence and
  downloadable branch snapshots; this is not a permanent public preview URL.
- `.github/workflows/remote-only-gate.yml`: branch configuration contracts,
  actual shared WASM compilation and Windows WebView2 acceptance. It does not
  install or validate AI models, OCR or model training.
- The published Viewer remains owned by main's `web-pages.yml`.
  Source writes, artifact publication to this branch and main deployment
  are distinct operations.

Git and data originals remain in their existing authoritative repositories.
Do not copy the entire library, training corpus, historical evidence or
Windows application artifacts into the Codespace. CI artifacts are short-lived
and are not the sole long-term storage for unique outputs. Preserve branch
data pins and SHA-256 source identity. Keep current and actively referenced
Windows binaries; retire only verified unused reproducible cache outputs.

## Independent Map Toolkit plugin boundary

History-map image analysis, OCR, ONNX/LibTorch inference and model training
belong to the independent Map Toolkit plugin (`plugins/pando-map-tools/`,
with its shared implementation in `tools/reference-analysis/`). The public
Viewer and Windows reviewer do not require its model-training environment.
The `work/remote-only` application's mandatory acceptance workflow must
not run these plugin-only tests or download LibTorch/CUDA/AI model assets.
Plugin acceptance belongs to a separate, explicitly selected plugin release
or training workflow and is not a blocker for remote-only application
development. This change does not remove the plugin or alter its artifacts,
training lineage, model approval gates or existing plugin release policy.
See [Independent map analysis](../reference-map-plugin.md).

## Real Codespaces live acceptance

Only a running, user-created Codespace can satisfy this gate. In its terminal
on `work/remote-only` run:

```bash
bash .devcontainer/acceptance.sh
```

This installs a browser **only in Codespaces** and runs
`tests/browser/codespaces-live.spec.mjs` against the existing, private port
4173 development server (no test-server fallback). Acceptance verifies
real Viewer map readiness and country presentation, year navigation,
source watcher on both a newly created CSS file and a subsequent edit to
that same file, two independent revision increments and automatic browser
reloads, WASM bytes and private-source access denial. A unique temporary, untracked
CSS probe is removed after testing; no tracked file or user WIP is changed.
Evidence and screenshots are saved under `test-results/codespaces-acceptance`.
Record the Codespace name, commit SHA and result. A GitHub Actions job is not
a genuine Codespaces run and cannot be substituted.

The real Codespaces test may take longer than the fast CI contract suite
because it waits for complete canonical map presentation after both reloads.
The fixture captures proof and the screenshot **before** removing the
untracked CSS probe; its cleanup is `finally`-guarded. No tracked source is
overwritten.

If the Codespace has not been launched or its terminal is unavailable,
report **BLOCKED**, not passed.

## Source-matched C++ / WASM / GIS integration

The `remote-only-gate.yml` acceptance now builds native GIS polygon tests and
the shared C++/WASM core on the same Linux runner from the exact branch commit.
It runs the established GIS numerical contract tests against **the freshly
compiled WASM**, using `PANDOEDITOR_WASM_MODULE` (not a prebuilt binary or JS
replacement). The job uploads a CTest XML and Node TAP receipt with the same
commit-linked evidence.

The dependent `viewer-map-integration` job downloads the exact WASM from the
preceding job and packages it into an **ephemeral CI checkout**, mounts the
library-data revision pinned to the source commit and runs the existing
desktop WebGL and mobile Canvas Playwright map-readiness checks. Only after
successful actual rendering and runtime assertions is that acceptance marked
passed. The checkout changes are never pushed or deployed.

The standalone C++ and WASM jobs are insufficient alone: this integrated gate
is required to prove native geometry, compiled runtime and map consumption
agree. This does not claim physical GPU equivalence or cover all historic
countries and time periods.

## Local build prohibition and immutable output retirement

The branch ships a tracked `config/remote-only-policy.json` marker, so detached
HEAD copies of this candidate also reject Pando-owned local SDK work.

The branch uses `scripts/lib/remote-only-native-policy.mjs` as the single
fail-closed gate on Pando-owned **local** native test preparation (including
capacity probes), compiler cache SDK activation / wrapper invocation, selected
application native prerequisites and native Windows binary downloads. On this
branch a missing source-pinned artifact does not trigger an SDK fallback:
explicit GitHub Actions is required. This cannot prohibit a developer from
manually running arbitrary OS compiler commands outside project tooling.

Codespaces prepares only locked Node development packages and a test browser.
SDK/compiler installations and native builds are exclusively on remote runners;
a Windows verification executable is run by Windows GitHub Actions, not
downloaded onto a developer PC.

Legacy PC artifact views are never automatically deleted. The existing
storage owner offers a **preview** of unreferenced, immutable, source-hashed
native views and an explicit, journaled operation:

```powershell
node tools/worktree-storage.mjs --retire-native
node tools/worktree-storage.mjs --retire-native --apply
node tools/worktree-storage.mjs --prune-blobs
node tools/worktree-storage.mjs --prune-blobs --apply
```

Only a user/local operator with access to the storage may opt into applying
these commands. They reject active applications, referenced versions, unknown
files and pending journals; shared blobs are freed only after all hard links
are removed and their own hashes are verified. No cleanup was executed by the
branch migration or on the developer PC.

## Remote output reuse and retention (bounded)

The CI gate now plans changes before heavy work. Documentation-only pushes
run contract checks without C++, Emscripten, SDK or Windows compilation.
Explicit `workflow_dispatch` selects full acceptance even when source input
files are unchanged. Unknown baselines are treated as needing full validation.

WASM cache key = SHA-256 of the canonical shared C++ source manifest,
root CMake inputs, pinned Emscripten and source-bound workflow/packaging
inputs. A cache hit is accepted only after digest, compiler version,
C++ core ABI/source identity and WebAssembly byte checks. The same cached
pair is then tested through the GIS adapters and sent to the browser test.
Cache misses compile on GitHub Actions, run geometry checks, **then** publish
the cache. No compiler SDK or build tree is stored in the reusable cache.

Windows verification cache key = the exact source-pinned native input SHA,
including the Git commit embedded in its executable. It is hash checked
against the manifest, source commit and binary `--build-info`. A cache
hit skips Rust compilation, but **never** skips the actual Windows WebView2
GUI acceptance; a miss saves its binary only after GUI acceptance succeeds.
A different Git SHA is not silently treated as a matching Windows build.

Per-run browser/GIS/Windows evidence uses GitHub Actions artifacts with
7-day WASM or 14-day diagnostic retention; disposable CI runner directories
are ephemeral. GitHub's managed cache eviction handles unreferenced cache
entries, so the system never requires developers to download/stage large
artifacts on their PCs. These are bounded reuse caches, not permanent
backups: original GIS/AI evidence and release-critical binaries must remain
with their canonical source owner. No historic cache, report or local
SDK was deleted during this migration.

## Acceptance boundaries

The branch's initial contract gate proves source configuration and safety
contracts, **not** full end-to-end correctness. Before claiming 100% remote
development, run and retain evidence for: a real Codespaces startup and
Viewer interaction, source-changed WASM build and browser parity, GIS source
rebuild on both supported runners, source-bound Windows reviewer build and
WebView display, and real Windows WebView display. These checks do not qualify AI/OCR/model
  training or GPU inference. Windows hardware GPU and local driver behavior
  cannot be certified by software-rendered Linux browser tests.

Codespaces and GitHub Actions depend on network availability, service quotas,
retention settings, permissions and runner capacity. If any is missing, fail
with an explicit blocked state. Never fall back to downloading multi-gigabyte
SDKs onto the developer's PC.
