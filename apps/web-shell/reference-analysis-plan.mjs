import { validateReferenceBoundaryManifest } from '../../assets/js/modules/reference-image-analysis-tiles.js';

const vendorBase = 'assets/vendor/reference-analysis/';
const dataBase = 'assets/data/reference-analysis/v1/';
export function referenceAnalysisAssetPlan(vendor, ocr, boundary = null) {
  if (vendor.schemaVersion !== 1 || ocr.schemaVersion !== 1 || JSON.stringify(vendor.languages) !== JSON.stringify(ocr.languages)) throw new Error('Reference OCR language manifests differ.');
  const entries = [];
  const add = (base, path, spec) => {
    if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(path) || path.split('/').some(part => part === '..' || part === '.')
      || !/^[a-f0-9]{64}$/.test(spec.sha256) || !Number.isInteger(spec.bytes) || spec.bytes < 1) throw new Error('Invalid reference analysis asset path or hash.');
    entries.push({ path: base + path, bytes: spec.bytes, sha256: spec.sha256 });
  };
  for (const [path, spec] of Object.entries(vendor.files)) add(vendorBase, path, spec);
  for (const [language, spec] of Object.entries(ocr.languages)) {
    if (!/^[a-z_]+$/.test(language) || spec.url !== language + '.traineddata.gz') throw new Error('Invalid reference OCR language path.');
    add(dataBase + 'ocr/', spec.url, spec);
  }
  if (boundary) {
    validateReferenceBoundaryManifest(boundary);
    add(dataBase, boundary.model.url, boundary.model);
  }
  return { entries, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0) };
}
