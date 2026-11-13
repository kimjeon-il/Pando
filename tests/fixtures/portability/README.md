# Current behavioral contract fixtures

These bounded JSON inputs and expected observations exercise the current Core and Viewer contracts. Selection, command, storage, geometry and calendar checks compare accepted behavior with explicit expectations. Do not regenerate expected values from the implementation under test.

The active owners and prerequisites are registered in `scripts/contracts/application-checks.json`. The selection sequence is exercised by `tests/unit/ui/selection-contract.test.mjs` using the actual Core. Use affected checks; fixture existence alone does not establish passing product behavior.
