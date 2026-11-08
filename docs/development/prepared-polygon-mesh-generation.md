# Scoped prepared polygon meshes

Use the existing build command for an explicit country/month scope:

    pnpm build:prepared-meshes --countries=KOR,PRK --months=1953-12,2026-10

IDs are the project country IDs in builtin-world/generated/v1/index.json; historical source IDs can differ. Include all active connected parents and subunits identified by the catalog. An incomplete selection fails before mesh output. Entirely inactive queries also fail without publication.

Scoped mode reads the two metadata indexes and selected active compiled country payloads once. It resolves only requested months through the existing country assembler and timeline engine, prepares the effective geometry and required parent extents/extras, and deduplicates identical geometry digests. It does not load raw source chunks, other countries, physical land or water inputs.

Existing meshes retain their verified bytes when the algorithm/precision contract and stored hash match. Unrelated mesh descriptors, input receipts and precision-discard records remain in the manifest. Superseded selected-country and selected raw-source receipts are retired without reading their old bytes. Stale unrelated receipts or old split-country parts that cannot be safely attributed block the append before output; regenerate an appropriate broader scope instead of marking that input fresh. An identical manifest is not rewritten. The current compatible manifest is required; scoped mode is an append operation, not a complete-catalog freshness receipt.

Omitting scope keeps the existing full generator. The existing --physical-month=YYYY-MM mode remains separate and cannot be combined with country/month options. Automatic P2 full-family generation is unchanged; do not mark a scoped append as a complete P2 rebuild or advance the runtime pin merely by generating files. Use the existing library write lease and scoped publication procedure for actual data changes.

Focused synthetic regressions: tests/unit/rendering/prepared-country-scope.test.mjs and tests/unit/prepared-physical-scope.test.mjs. No full GIS regeneration or native rebuild is needed to verify this JavaScript generator change.
