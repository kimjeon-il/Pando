import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../fixtures/portability/web-9300609-hydro-hidden/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
if (manifest.baseline !== '930060923889d17134e36e152c29f4adbb2e60a9'
  || manifest.schema !== 'pandoeditor-web-supplemental-oracle') throw new Error('The original hydro evidence baseline changed.');
const row = manifest.files[0], bytes = readFileSync(new URL(row.path, root));
if (createHash('sha256').update(bytes).digest('hex') !== row.sha256
  || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== row.blob)
  throw new Error('The original hydro renderer Git blob changed.');
const source = bytes.toString('utf8'), start = source.indexOf('    function aggregateHydroLogicalFeature(logicalId) {');
const end = source.indexOf('\n    function registerHydroFragments(', start);
if (start < 0 || end < start) throw new Error('The canonical original hydro aggregation function is missing.');
// Execute the exact original closure body with resource-only ports. No DOM,
// WebGL initialization, project reducer or alternate model validator is used.
const createAggregate = new Function('state', 'prepareHydroFeature', `${source.slice(start, end)}\nreturn aggregateHydroLogicalFeature;`);
export function originalHydroAggregation(logicalId, fragments, hiddenHydroIds) {
  const state = { hydroFragmentsByLogicalId: new Map([[logicalId, new Map(fragments.map((feature, index) => [index, structuredClone(feature)]))]]),
    hydroFeatureCache: new Map(), hydroFeatureByFid: new Map(), physicalSettings: { hiddenHydroIds: structuredClone(hiddenHydroIds) },
    stateRevision: 17, dirty: false };
  const aggregate = createAggregate(state, feature => feature)(logicalId);
  return { aggregate, hiddenHydroIds: state.physicalSettings.hiddenHydroIds, stateRevision: state.stateRevision, dirty: state.dirty };
}
