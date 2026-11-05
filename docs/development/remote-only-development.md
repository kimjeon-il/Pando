# Pando remote-only development (work/remote-only)

Baseline: main commit `5b636f814f397cd0d8b2a64c8e7ddfab1c02c51e` (2026-11-04).
This branch is an isolated migration candidate. Do not merge into main or deploy
GitHub Pages without the user's separate approval.

## Optional Codespaces, no automatic startup

Codespaces is no longer required for normal Viewer/inspector development;
GitHub Actions owns the WASM/GIS builds, automated browser tests and Web
screenshots. The optional [work/remote-only Codespace](https://codespaces.new/kimjeon-il/Pando/tree/work/remote-only?quickstart=1)
uses the Node 24 Bookworm image. **Container creation and restart do not
install packages, start the preview server, forward port 4173 automatically
or launch a browser tab.** No Windows native SDK is installed.

Only if you need to inspect the live source manually, open a Codespaces
terminal and run:

```bash
bash .devcontainer/start-preview.sh
```

The first manual invocation installs locked pnpm frontend packages if they
are not present, then starts the Viewer on `127.0.0.1:4173`. Subsequent
invocations reuse the live server. In the Codespaces **Ports** panel, manually
forward port **4173** as **private** and open the preview. Do not make this
port public. You can also run `bash .devcontainer/setup-remote.sh` manually
to prepare packages without starting the server.

Use the smallest practical Codespaces machine (**2 cores / 8 GB**), and
prefer **15 minutes idle timeout** and **7 days stopped retention**.
These are GitHub user/Codespace account settings, **not enforceable by
`.devcontainer/devcontainer.json`**; select the machine size at creation
or change it from the Codespaces UI, and set timeout and retention under
GitHub **Settings → Codespaces**. The settings apply to new Codespaces and
do not retroactively resize or stop a running existing Codespace.
Check `https://github.com/codespaces` to stop or delete unused sessions.
Never rely on a repository commit to stop an already-running billable session.

The small optional smoke check, with no Chromium installation:

```bash
bash .devcontainer/acceptance.sh
```

This checks the actual development server, pinned WASM header, world
manifest and private configuration boundary. If a full local live-browser
acceptance is specifically needed, run
`bash .devcontainer/acceptance.sh --browser`. That **explicit** mode
installs Playwright Chromium into Codespaces and runs the original map,
time-navigation and source-watcher test. Ordinary regression must run in
GitHub Actions instead. Neither mode is a prerequisite for GitHub CI.

For read-only local prerequisite diagnostics after package installation:

```bash
node scripts/remote-only-doctor.mjs
```

Do not run `pnpm deps:prepare` or any local CMake, Emscripten, Rust,
LibTorch or native GIS SDK preparation in Codespaces.
If Node 24 is missing, select **Codespaces: Rebuild Container**. This
retains files in `/workspaces` but resets container-level state. On
older existing Codespaces the previous lifecycle configuration can remain
active until their development container is rebuilt.

## Windows native reviewer retirement (work/remote-only)

The integrated Web Viewer inspection panel replaces the standalone
Windows Tauri/WebView2 reviewer in this branch. The P1 workflow no longer
accepts `native` or `native-tests` dispatch requests and the remote-only
acceptance has no Windows build or GUI job. Root `dev:windows` and
`build:windows` package scripts and `@tauri-apps/cli` dependency are
retired. The source-bound C++ Core, WASM, GIS and browser acceptance
still run in GitHub Actions, not on the Windows PC.

Archived Windows source and storage cleanup code must not be mistaken
for a supported executable. Preserve existing user's binaries and
references; this migration does not delete PC files.

## Builds and verification are owned by CI

- P1 `.github/workflows/remote-development-p1.yml`: source-aware UI,
  C++, GIS and WASM runner jobs only. This branch is a push target.
- P2 `.github/workflows/generated-artifacts-p2.yml`: regenerate only
  changed source-bound WASM/data families and publish with a guarded
  work-branch fast-forward, not to main. Do not use `all` casually.
- P3 `.github/workflows/remote-preview-p3.yml`: browser evidence and
  downloadable branch snapshots; this is not a permanent public preview URL.
- `.github/workflows/remote-only-gate.yml`: branch configuration contracts,
  actual shared WASM compilation and GIS/Viewer browser acceptance. It does not
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
belong to the independent [Map Toolkit repository](https://github.com/kimjeon-il/map-toolkit).
The public
Viewer and Windows reviewer do not require its model-training environment.
The `work/remote-only` application's mandatory acceptance workflow must
not run these plugin-only tests or download LibTorch/CUDA/AI model assets.
Plugin acceptance belongs to a separate, explicitly selected plugin release
or training workflow and is not a blocker for remote-only application
development. This boundary does not alter the plugin's artifacts,
training lineage, model approval gates or existing plugin release policy.
See [Independent map analysis](../reference-map-plugin.md).

## Optional live Codespaces acceptance

Codespaces is an opt-in **manual preview**, not a required development
or full acceptance environment. No packages, preview, browser or auto-open
are started by the container lifecycle. `bash .devcontainer/acceptance.sh`
runs an inexpensive real-server HTTP smoke. The heavy original
`tests/browser/codespaces-live.spec.mjs` is retained solely for a
deliberate `--browser` invocation. It tests actual canonical map frame
readiness, year navigation, two source-watch reloads and file isolation.

The existing P3 GitHub Actions tests provide the normal Web/Canvas and
mobile/desktop browser verification without requiring any Codespace.
A passing CI contract test is not proof that a personal Codespace
session was opened. `main` deployment is still separately controlled.

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

Codespaces installs frontend dependencies only on deliberate preview, and a test browser only on deliberate --browser acceptance.
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


## Integrated hidden Viewer inspection panel

The Web Viewer itself provides the inspection interface. On an ordinary
`/` navigation both desktop `reviewPanelBtn` and mobile `mobileReviewBtn`
remain **hidden**, and `viewer-review-panel.js` is not imported.

To deliberately enter inspection mode, use either `?inspect=1` in the
Viewer URL or the `Ctrl+Shift+.` keyboard shortcut (`Cmd+Shift+.` on
macOS). The URL opens the read-only map diagnostics tab; the shortcut toggles
the panel. The existing `?debug=1` development entry continues to reveal
the legacy button for browser regression tools, but does not open the panel
automatically. After activation the inspector button stays visible for the
current page session; browser navigation resets it.

The lazily loaded panel contains four tabs:
- **Change review:** E3 revision evidence JSON, SHA verification, side-by-side
  geometry comparison and a user-initiated local correction-request file.
- **Map and data:** current canonical mesh/terrain readiness, renderer,
  source revision and document status. This is not a GIS topology certification.
- **Performance:** captured browser metrics when `?perf=1` is enabled;
  absent samples are explicitly shown as unavailable.
- **Errors:** bounded diagnostic events and an explicit local JSON export.
  No event is automatically sent to GitHub or to an external endpoint.

The panel is not an authorization boundary. Hiding it does not protect
private data and does not grant edit, source-publish, or GitHub credentials.
Existing Viewer Core/project mutations remain blocked by the read-only
domain regardless of entry method. The separate Tauri Windows reviewer
pipeline remains untouched during this UI migration; remove it only after
separate approval of the browser inspector's acceptance and migration.
No `main` merge or Pages publication occurs on this branch.

## Deleted Windows package and Rust build sources

Windows Tauri Cargo manifests, Rust executable code, native producer,
artifact fetch scripts, CLI, and Windows-only CI jobs were removed on this
branch. Common C++/WASM and GIS tools remain on GitHub Actions. Read-only
Viewer inspection is available through `?inspect=1` or `Ctrl+Shift+.`.

Only legacy test fixture staging, old verified artifact cleanup and a small
number of inert brand/config files are retained; they cannot build a Tauri
application. No existing user PC file is automatically deleted.


## P2 isolated library publication after Windows retirement

P2 generated artifacts belong to the current Pando work branch, **not**
automatically to the `index.branch` of the input library edition.
For example, `work/remote-only` can start from the pinned work/gis edition
without advancing or rewriting the library's shared `work/gis` history.
The P2 archive preflight now requires the checkout's `HEAD` to equal the
exact configured library revision and requires the *target* branch to be
absent or still at that same revision. P2 never force-pushes. A concurrent
target-branch advance still aborts publication.

Do not silently change `config/library-data.json` to the newest
`work/gis` branch: doing so could activate unapproved historical
geography changes. P2 first verifies and publishes source-bound outputs in
the isolated branch, then advances the application revision pin only after
the library push succeeds. Another worktree's GIS edits remain untouched.


P2 storage publication now pushes `HEAD:refs/heads/work/remote-only`
rather than the ambiguous `HEAD:work/remote-only`. The fully qualified
target is needed on the first push of an absent library branch. A focused
bare-Git regression fixture verifies creation from the exact source pin,
an unrelated `main` branch staying untouched, and non-force rejection of
a concurrent target update. The storage writer still verifies the remote
SHA and advances the application pin only after the remote push succeeds.


## Post-Windows web regression after repository replacement

The `post-windows-web-regression` Linux Actions job tests the complete
source-only Web inspection integration: bounded diagnostics, hidden
activation, E3 change comparison, map and mobile interaction, and local
correction/evidence exports. Its P2 library storage fixture verifies
that creating a previously nonexistent `work/remote-only` branch uses
`HEAD:refs/heads/work/remote-only`, while a concurrent update refuses a
non-fast-forward push. The job rejects retired Cargo/Rust, native
Windows producer, and Windows-only CI paths without installing any Windows
SDK. The separate `wasm-compile-and-smoke` and
`viewer-map-integration` jobs remain responsible for actual shared
C++/WASM/GIS/map rendering, not mock results.

This branch is not deployed to GitHub Pages and `main` is not changed
by the acceptance. No independent Map Toolkit training or model artifacts
are installed for the review. The actual P2 publication must report a
successful source-pinned library branch push before it is accepted.
