# Reference image main integration — 2026-10-08

> 보고서 ID: `DEV-055` · 상태: `historical-record` · 지도 반영: `not-applicable` · 색인일: 2026-10-12  
> 원문 최종 수정: 2026-10-08  
> 원본: [앱 `docs/reference-image-main-merge-validation.md`](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/reference-image-main-merge-validation.md)  


Feature: b3fdf709afa14732628c0066deedce8f8a6b4367.
Main incorporated: 0e9b4912f4b9564a192177183cbbdb73ffb9342b.
Reference calculation Web pin remains ebcfae4d27b29cbbea6416a7045a4806930204be.

Main gained engine GeometryDraft history and canonical SelectionState-derived selection after feature validation. The merge resolves one conflict in app/editorgeometry.cpp: new line Undo/Redo remains intact; polygon Undo/Redo and reference draft replacement use the engine undoDraft/redoDraft/checkpointDraft APIs. Auto-merged session inheritance/constructors retain line history and unique reference-session initialization. No original Web module, fixture/expected, project codec/schema or reference UI changed during integration.

A separate read-only focused reviewer checked both sides of this merge: no Critical/Important finding, all seven constructor callers and selection reset preserved, no unresolved conflict. Reviewer ran no builds or tests.

## Actual integration checks

Windows11 / Qt6.8.3 / MinGW13.1, ordinary Release build; installed Qt on PATH, no packaged runtime.

- Production pandoeditor and edit_display_ui_tests, edit_geometry_tests, selection_editor_tests rebuilt: process exit0; [build log](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-main-merge/build.txt).
- Engine: seven declared checks actually executed,7 PASS,0 failure, exit0; [raw log](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-main-merge/engine.txt). Uses throwing require checks even in Release.
- Canonical selection/draft preservation: selected3 functional cases + init/cleanup =5 PASS,0 failure/skip, exit0; [raw log](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-main-merge/selection.txt).
- Real Windows/D3D11 requested UI: tracing, refinement, pixel keyboard nudge, Space cancellation, line-history phase reset; selected5 functions + init/cleanup =7 PASS,0 failure/skip/missing,112665ms, exit0; [raw log](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-main-merge/window.txt).
- [Integration binary SHA256](https://github.com/kimjeon-il/PandoEditor/blob/f535673993f45957b82d125ff766ed1e18233170/docs/evidence/reference-image-main-merge/hashes.json). Original full seven-flow evidence in reference-image-web-parity-validation.md is historical; it is not substituted for these current merged-source executions.

First build command used the nonexistent target selection_tests and exited1 before compilation/testing. Corrected to existing selection_editor_tests; successful build and actual tests above are separate executions. Failure was not masked. Original failed invocation log remains D:/build/reference-main-merge-build.log.

## Reproduction

Build: cmake --build D:/build/Pandoeditor-reference-parity --target pandoeditor edit_display_ui_tests edit_geometry_tests selection_editor_tests -j2.
Run engine/edit_geometry_tests.exe; then QT_QPA_PLATFORM=offscreen selection_editor_tests.exe selectingDoesNotCommitOrDiscardDrafts scopesPrimaryAndInvalidReferences sessionActionsPreserveHistoryAndBytes:desktop.
Run QT_QPA_PLATFORM=windows / QSG_RHI_BACKEND=d3d11 edit_display_ui_tests.exe liveWireActualWindowToDraftFlow lineRefinementActualWindowPreservesDraftUntilApply keyboardVertexMovementUsesScreenPixelsAndFocusGuards spaceTemporaryPanReturnsToEditingAcrossCancellation referenceLineHistoryHasVisibleRedoAndResetsWithMethod.
Check each native process exit separately. No full CTest, M9.8 repeat, deploy/tag/release or portable generation. Existing large-image/blend/seam limitations remain as reported; main integration does not turn them into PASS.
