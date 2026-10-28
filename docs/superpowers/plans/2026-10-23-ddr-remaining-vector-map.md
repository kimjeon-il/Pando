# DDR remaining borders — implementation boundaries

Status: closed historical implementation plan. Research findings and map interpretation are maintained in the [external research record](https://github.com/kimjeon-il/PandoLab-library-data/blob/main/reports/borders/reconstruction/germany/ddr-remaining-plan-record-2026-10-23.md) and its linked consolidated report.

For a separately requested follow-up:

1. Reuse the country source owner and C++ recipe; admit modern vectors only where period validity or continuity is supported.
2. Follow docs/historical-border-reconstruction-policy.md: select major changes and important exceptions at Natural Earth 1:10M. Complete recovery of every held local sector and subpixel historical matching are not requirements.
3. Keep project identity, source geometry, uncertain river claims and unrelated boundaries separate. A map review is required before adopting traced geometry.
4. Regenerate and check only affected dependencies after an explicitly authorized geometry change. Keep source date, provider georeferencing and independently measured accuracy distinct.

Source reports retain the historical application and licensing status; this specification does not approve a new boundary or release.
