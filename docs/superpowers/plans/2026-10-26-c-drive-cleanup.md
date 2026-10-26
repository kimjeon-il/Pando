# C drive cleanup implementation plan

Approved specification: the user's 2026-10-26 C-drive cache, retired-output and SQLite free-page cleanup plan in this chat.

- Reuse work/objects; preserve its runtime data pairing, unrelated WIP, source/history and all current tools/apps.
- Extend the existing generated retirement manifest/journal engine with fixed C-profile cache and retired-output scopes and verified cross-volume evidence relocation.
- Preserve Playwright 1228/1234, GPU/Codex runtimes, active ADB/Qt/Java, keys, browser persistent state, sources and unique evidence. Move inactive originals to library private evidence with exact byte verification.
- Implement Node built-in SQLite offline maintenance with backup, logical/integrity proofs, incremental vacuum, bounded WAL and restart-safe receipts. Never mutate live Codex databases.
- Apply safe idle filesystem scopes now; prepare one external command for the closed-app phase. No forced process termination or policy bypass.
- Run synthetic scoped tests, one fresh final safety review, commit/push task tools to work/objects only, publish only reports/development/storage/c-drive-cleanup-20261026 after each completed report stage.
- Completion distinguishes actual deletion/relocation, skipped/blocked items, allocated/file-ID payload and measured C/D free space; remove finished scratch/journals/backups after verification.
