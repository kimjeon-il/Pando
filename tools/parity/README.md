# Web / App parity

`tests/fixtures/portability/index.json` is the sole feature registry. The App
runner (`tools/run-final-oracles.mjs`) reads it from an explicitly supplied Web
checkout. Registry entries link owners, relevant sources, dependencies, tests
and observation axes. Markdown matrices are generated, never maintained by hand.

## Evidence levels

- `current`: one shared input runs against both current implementations, with
  an independently specified expectation. Only this can establish parity.
- `supporting`: actual production unit/controller/browser tests. A failure is
  blocking; a pass alone does not prove Web/App equality.
- `historical`: an archived Web source/corpus compared with native code. This
  protects a past contract; it is never evidence that current Web equals App.

The initial registry covers 23 domains. A registered domain does **not** imply
complete observations: missing paired/UI observations remain `NOT_RUN` in the
generated matrix. The framework and the product's behavioral parity have
separate completion criteria. Do not describe this initial inventory as full
behavioral coverage.

## Running

From the App checkout (use absolute paths for local builds):

```text
node tools/run-final-oracles.mjs --web-root WEB --list
node tools/run-final-oracles.mjs --web-root WEB --features selection,timeline --build-dir BUILD --build --out REPORT.json
node tools/run-final-oracles.mjs --web-root WEB --changed CHANGES.json --build-dir BUILD --build --out REPORT.json
node tools/run-final-oracles.mjs --web-root WEB --build-dir BUILD --build --ui --official --out REPORT.json
```

`CHANGES.json` contains repository-relative `web` and `app` path arrays.
Unmapped relevant source paths fail classification. Shared infrastructure changes
select every feature. `--features` is an explicit diagnostic subset and cannot
establish complete behavioral parity. Omitting both selects all features.

`--official` requires clean checkouts. Local dirty results contain fingerprints
and remain distinguishable from committed evidence. Native observations require
a source- and executable-matching build receipt. A receipt from another checkout
state is rejected. Output includes JSON, a Markdown matrix and raw evidence logs.

## Comparison contract

Absent properties, nulls, array order, reference types and coordinates are exact.
There is no implicit default filling or coordinate rounding. A mismatch records
both actual values, the expectation, presence flags and a JSON pointer. The
geometry helper permits only explicitly selected representation equivalences;
editing traces must retain vertex/ring ordering. Raw outputs remain evidence.

The command/history fixture asserts one rename per undo unit and a clean state
when returning to a saved document. The current Web save-token implementation
keeps dirty on history travel; this is deliberately observable and must not be
rewritten by the adapter. Product behavior is unchanged by this verification work.

Known differences require an exact case ID and exact mismatch records. Do not
automatically update expectations, register failures, or broaden an exception.
An exception that disappears also requires review rather than silently persisting.

## Provenance and approval

The App's `docs/platform-portability-pin.json` names the approved Web commit and
raw file SHA-256 values. New registry/corpus files must first be committed and
reviewed as a candidate; the approved pin must not silently follow HEAD. Retain
the previous commit and corpus so historical runs remain reproducible. Windows
German historical geometry regeneration remains a separate exact-generation test.

## Remaining observation work

Current paired observations cover ordered selection; metadata/lock/history;
parent/cycle/delete-eligibility rules; containment and exact clipping; controlled
job completion/discard; timeline validation/storage; JSON/GeoPackage traces;
catalog search/version and fixed-response loading/retry/cache. The file trace
also includes one complete content document, preserving every saved field.
These fixtures establish their registered cases, not every behavior in a domain.

The registry's production tests provide starting points for remaining paired
adapters in complete editing sessions, object-specific mutations, autosave failure
and recovery, provider cancellation/resource release and matched UI/render flows.
Until these adapters emit matched scenario/step observations, successful unit or
Playwright/Qt tests do not fill those parity cells. Native tests that exclude
fixture cases are reported as `UNSUPPORTED`, not dropped from counts. Desktop
or simulated mobile input is never Android physical-device evidence.

Every invocation writes a fresh evidence directory. Qt completion and skipped
cases are read from its file logger, not inferred from an empty Windows stdout.
Local native Qt input currently needs the installed Windows platform runtime;
a timeout remains ERROR and cannot be reclassified using earlier output.
