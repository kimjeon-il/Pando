# Country loading and automatic current month

Approved conversation plan: replace the single stored world project with
country-scoped derived files; fetch only countries needed at the selected month,
with at most six parallel reads. Reuse the existing Core admission and rendering
owners; assemble their input in memory, never publish an aggregate project.

The builtin viewer starts at the device-local current month and follows month
rollover/focus until manual date navigation. Reopening builtin returns to automatic
mode. Never replace an editable or opened user project because the clock changed.
Undated current geometry is a provisional present-month context only; dated source
coverage, exact changes, hierarchy and historical overlap rules remain unchanged.

1. Back up old generated v1 project, manifest, diagnostics and dated query recipe
   to D:/dev/release-evidence/PandoLab/legacy-world-project/ab4112e0; verify hashes.
2. Generate country-scoped historical/current-context data, index and reusable
   meshes; replace the single-file loader and builtin source admission.
3. Implement clock-following builtin query state and atomic last-request-wins
   month changes. Update native resource profiles, publication and staging together.
4. Remove retired files only after verified backup, update focused contracts/tests,
   verify browser loading/date changes and publication without full app builds.

Worktree: permanent work/gis. No main integration, push or deployment in this task.
Relevant checks only. Raw evidence and country originals remain unchanged.
