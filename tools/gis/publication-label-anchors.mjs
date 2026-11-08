import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function retainedLabelAnchors({ before, after, anchors }) {
  if (!Array.isArray(before?.features) || !Array.isArray(after?.features)
    || anchors?.version !== '0.10.1' || !anchors.anchors) {
    throw new Error('Invalid publication label anchor input');
  }
  const originals = new Map(before.features.map(feature => [String(feature.id), JSON.stringify(feature.geometry)]));
  const retained = {};
  for (const feature of after.features) {
    const id = String(feature.id);
    if (originals.get(id) !== JSON.stringify(feature.geometry)) continue;
    const anchor = anchors.anchors[id];
    if (Array.isArray(anchor) && anchor.length === 2 && anchor.every(Number.isFinite)) retained[id] = anchor;
  }
  return { version: anchors.version, method: anchors.method, anchors: retained };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => {
    const at = process.argv.indexOf(name);
    return at < 0 ? null : process.argv[at + 1];
  };
  const before = JSON.parse(readFileSync(arg('--before')));
  const after = JSON.parse(readFileSync(arg('--after')));
  const anchorFile = arg('--anchors');
  const anchors = JSON.parse(readFileSync(anchorFile));
  const output = retainedLabelAnchors({ before, after, anchors });
  writeFileSync(anchorFile, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Retained ${Object.keys(output.anchors).length} unchanged country label anchors`);
}
