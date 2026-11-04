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
