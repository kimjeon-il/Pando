# Country objects and LSIB supplementation

Approved plan: one country/territorial object per source JSON; lineage reference files;
dated geometry remains inside its owning object. The world display is an explicit
entity/version selection, never the source or proof of a common historical date.
Use LSIB 11.4 for eligible modern non-disputed land borders, retain existing
sovereignty, historical versions and coastline. Report every withheld boundary.
No merge to main, push or deployment. Reuse work/gis and preserve unrelated files.

1. Split source objects losslessly, update source readers/writers and current consumers.
2. Replace the dated startup snapshot with an explicit entity/version view and update
   catalog, publication, editing and date selection. Keep actual dated presets separate.
3. Pin full LSIB evidence, apply matching undisputed shared chains atomically to both
   counterparts, retaining problematic/disputed/special/historical segments.
4. Regenerate affected data derivatives and verify focused source, catalog, publication,
   editing and real lookup workflows. Record omissions and evidence under reports/.

Acceptance: identities/periods and unrelated geometry preserved; one coordinate owner;
independent data publication retained; no modern-to-historical propagation; shared
boundaries valid; presentation derivative within 0.5 CSS px of its master at 2560/64.
