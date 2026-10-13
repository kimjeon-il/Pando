// Read-only audit by default. --write updates only product-owned catalog
// geometry versions and never overwrites pinned external GIS source files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
await import('../assets/js/modules/polygon-geometry.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const countryDirectory = path.join(root, 'assets/data/territorial-entities/source/countries');
const check = process.argv.includes('--check');
const write = process.argv.includes('--write');
if (check && write) throw Error('Use either --check or --write');
const normalizer = globalThis.PandoLabPolygonGeometry;
const report = { schemaVersion: 1, examinedVersions: 0, canonicalVersions: 0, rewoundVersions: 0, invalidVersions: 0, issues: [] };
for (const filename of fs.readdirSync(countryDirectory).filter(file => file.endsWith('.json')).sort()) {
  const file = path.join(countryDirectory, filename);
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = false;
  for (const entity of document.entities) {
    for (const version of entity.geometryVersions) {
      report.examinedVersions += 1;
      const identity = { file: filename, entityId: entity.entityId, versionId: version.versionId };
      try {
        const valid = normalizer.hasCanonicalPolygonWinding(version.geometry);
        if (valid) { report.canonicalVersions += 1; continue; }
        const normalized = normalizer.normalizePolygonGeometry(version.geometry);
        if (!normalized || !normalizer.hasCanonicalPolygonWinding(normalized)) {
          throw Error('Canonical normalization did not produce valid spherical winding');
        }
        report.rewoundVersions += 1;
        report.issues.push({ ...identity, issue: 'noncanonical-spherical-winding' });
        if (write) { version.geometry = normalized; changed = true; }
      } catch (error) {
        report.invalidVersions += 1;
        report.issues.push({ ...identity, issue: 'invalid-geometry', detail: error.message });
      }
    }
  }
  if (changed) fs.writeFileSync(file, \`\${JSON.stringify(document, null, 2)}\n\`);
}
console.log(JSON.stringify(report, null, 2));
if (report.invalidVersions || (check && report.rewoundVersions)) process.exitCode = 1;
