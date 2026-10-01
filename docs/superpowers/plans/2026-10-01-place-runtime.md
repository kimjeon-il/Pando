# Place mechanism implementation plan

Base: main c134b297. Branch: codex/place-runtime-million.
User authorized consecutive implementation, focused verification and publication
on an isolated branch. Stage 8 is explicitly excluded.

- [x] 1. Canonical place contract, test-only synthetic fixture builder and binary codec.
- [x] 2. Hydro tile-window reuse, module Worker, latest-wins viewport requests.
- [x] 3. Atomic builtin snapshot merged in existing label layout; interaction freeze.
- [x] 4. Absolute candidate caps, byte/cache budgets and actual million-record Worker gate.
- [x] 5. Canonical builtin selection and readonly properties/actions.
- [x] 6. Existing object search controller merged with bounded Worker prefix search.
- [x] 7. Editable user copy with provenance, existing history/autosave and Undo.
- [x] Focused tests, affected browser workflows and independent review.
- [ ] Commit and publish the isolated branch; verify remote SHA.

No real dataset or production-data build pipeline is part of this work. The
production manifest remains empty. Detailed ownership, limits, commands,
measured results and the pre-existing boundary-check failure are recorded in
[place-runtime.md](../../place-runtime.md).
