# C profile maintenance

Run from the permanent `work/objects` checkout. This is an explicit maintenance
command, never a startup hook. It uses the existing storage activation and
generated-output retirement engine. Local compilers must already be disabled.

```powershell
node.exe tools/worktree-storage.mjs --cleanup-c-drive=preview
node.exe tools/worktree-storage.mjs --cleanup-c-drive=apply
```

The fixed profile policy covers retired C GNU Cargo targets, dedicated old
Pandoeditor toolchains/packages, known metadata caches and synthetic test
fixtures. It keeps source bytes and ended unique evidence in the library's
`private-evidence/worktree-storage/c-drive-cleanup-20261026` with original paths,
sizes and SHA-256 in the manifest. It never follows reparse points. Current
Playwright installations, GPU/Codex runtimes, current ADB, shared Java/Qt,
Android user/signing keys, browser persistent state and unknown content stay.

The manifest, policy, digest, file-ID/NTFS allocation audit, resume journal and
result live in the existing shared cache's `c-drive-cleanup-20261026` directory.
Re-running apply resumes the same journal. A changed source or manifest stops
the operation. An active consumer blocks its exact scope; do not kill it or
remove its lock. Do not edit a pending manifest to force it through.

After **all other work finishes**, exit Codex and Edge normally. In an external
terminal, run the prepared `run-offline.cmd` in that maintenance directory. It
uses the recorded existing Node executable and this checkout, not a compiler or
SDK. It refuses live Codex/Edge/WebView processes, cleans only cache leaves,
then maintains the seven explicit Codex SQLite databases using `node:sqlite`.

Each database must already use incremental auto-vacuum. SQLite acquires an
exclusive connection, creates a consistent D-drive backup, verifies integrity,
schema, keys, row counts and a type-aware logical SHA-256, and reclaims free
pages in batches. It checkpoints through SQLite; WAL files are never manually
deleted. On interruption, the source and recovery proof must still agree.
Unexpected files or altered recovery bytes stop maintenance.

Reopen Codex and verify existing projects, conversations and login. Only after
the user confirms that check, run `--cleanup-c-drive=confirm` to remove recovery
copies. Never publish DB backups or private diagnostic payloads with the public
report. Publish the selected report scope through the normal report owner.

Logical bytes, unique allocated primary-stream bytes (including NTFS
compression and hardlinks), and measured C/D free-space changes are separate
metrics. Concurrent applications can affect the latter; metadata and alternate
streams are not included in the allocation estimate.
