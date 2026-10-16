# Temporal editing execution

Source: `adf34990` on `work/objects`. Approved in conversation 2026-10-16.

## Rules
- Source selection date is provenance; insertion uses the active map month.
- Dated edits last until the next explicit change for the same field.
- Administrative parents must contain children over the affected interval; ordinary reparenting never expands geometry.
- Name, flag and color get independent temporal overrides. Existing identity/style fields are immutable baseline defaults during dated edits, not a second current editable state.
- Unknown historical place names display `(현)` immediately before the modern name, per user correction.
- Cursor stays session state. Serialized editorState.lastViewedMonth is a reopening hint, excluded from document undo/dirty semantics.
- No old format readers. Regenerate current generated inputs and update affected fixtures.

## Execution ledger
- [ ] P0 Qt historical insertion, atomic history and stale preparation
- [ ] P1 common parent validation and temporal properties
- [ ] P1 source availability and historical name evidence
- [ ] P2 last viewed month persistence
- [ ] Focused Web/WASM/Qt regression evidence and report

Implementation uses one native integration agent; no additional agents. Native and WASM builds run remotely. Main integration/deployment is outside this request.
