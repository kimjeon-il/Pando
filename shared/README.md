# Shared C++ core

`core/` owns the Qt-independent C++ document, commands, timeline, selection and
detached geometry draft. Native builds and Emscripten compile the same sources
and link `Pandoeditor::Core`. Platform codecs keep their current external formats,
media validation, source catalogs and geometry engines at explicit boundaries.

## Build and bounded checks

Use Emscripten **4.0.20** in an ignored local SDK/build directory. With that SDK
active only in the current process:

```sh
emcmake cmake -S shared -B build-native/wasm -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF
cmake --build build-native/wasm --target pandoeditor_wasm --parallel 1
PANDOEDITOR_WASM_MODULE=/absolute/coherent/pandoeditor-core.js node --test shared/tests/wasm-document-session.test.mjs
```

The generated module and binary are `build-native/wasm/wasm/pandoeditor-core.js`
and `pandoeditor-core.wasm`. Package that pair with its source/compiler/ABI
manifest using `tools/package-shared-core-assets.mjs`. Tests may use an immutable
copy selected by `PANDOEDITOR_WASM_MODULE` while another build is running.

A native C++17/Zlib standalone build uses `shared/` with `BUILD_TESTING=ON`.
Build only the relevant targets with `--parallel 1`, then run their exact CTest
names with `--timeout 10`. Current small targets include `document_session_tests`,
`project_codec_tests`, `web_content_codec_tests`, `source_admission_tests`, `web_storage_tests`,
`web_object_command_tests`, `web_content_command_tests`,
`web_territorial_command_tests` and `geometry_draft_tests`. Do not launch the app,
GUI/offscreen tests, full-world fixtures or all CTest targets for these checks.

## Session boundary

```js
const module = await createPandoeditorCore({ locateFile });
const session = new module.DocumentSession({ validateFlagDataUrl });
const state = session.documentLoad(currentProjectJson, currentUtcMonth);
const world = session.resolveWorld(state.timelineCursor, state.epoch);
session.delete();
```

`DocumentSession` owns one `Project`, its immutable command history, selection,
draft and epoch. Commands use typed operation envelopes and small accepted
object/geometry/presentation deltas. Preparation creates one bounded candidate;
confirmation validates its epoch before committing. Failed preparation or
serialization leaves the model and history unchanged. Undo and Redo travel the
same whole-document history; detached draft Undo has its own primitive history.

Full project JSON is used only at load, import validation, source admission and
save/export boundaries. Timeline queries return IDs, immutable geometry refs,
relations and validity. Selection catalogs replace only one explicit built-in
domain, and platform facts never become another writable document.

Storage baselines have explicit `stored-asset` and `static-features` source
protocols. Stored assets accept `gzip` or `identity` bytes and verify the stored
bytes, fingerprint and size limits before current-format decoding. Identity
sources require equal stored/decoded byte counts and avoid recompression for
assembled country scenes. The browser retains the admitted handle and receipt,
not the large source byte buffer. Baselines are immutable source
facts; dirty territorial IDs derive from the canonical Project/history.
File export and autosave retain their current full/delta policies. Native and
Web format differences are tested and reported separately.
