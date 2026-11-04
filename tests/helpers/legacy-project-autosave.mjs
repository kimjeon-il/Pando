// Compatibility adapter for historic autosave/Core tests only. GIS publication
// uses project-template-compiler.js; the deployed Viewer never imports this file.
import {createProjectTemplateCompiler} from '../../tools/gis/project-template-compiler.js';
import {assertCurrentProjectSchema,assertProjectBaselineFingerprint} from '../../shared/frontend/js/modules/project-state.js';
import {normalizeTerritorialIdentities} from '../../shared/frontend/js/modules/territorial-units.js';
import {geometryRevision} from '../../shared/frontend/js/modules/geometry-versions.js';
export {fingerprintProjectBaseline} from '../../shared/frontend/js/modules/project-baseline-fingerprint.js';

// Only history owns these frozen copies. Live editing coordinates never alias them.
export function createGeometrySnapshotPool() {
  let copies = new WeakMap();
  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  function clone(value) {
    if (!value || typeof value !== 'object') return value;
    if (value.type && (Array.isArray(value.coordinates) || value.type === 'GeometryCollection')) {
      const revision = geometryRevision(value);
      let entry = copies.get(value);
      if (!entry || entry.revision !== revision) {
        entry = { revision, geometry: freeze(structuredClone(value)) };
        copies.set(value, entry);
      }
      return entry.geometry;
    }
    if (Array.isArray(value)) return value.map(clone);
    if (Object.getPrototypeOf(value) !== Object.prototype) return structuredClone(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  function restore(value, current) {
    if (!value || typeof value !== 'object') return value;
    if (value.type && (Array.isArray(value.coordinates) || value.type === 'GeometryCollection')) {
      const entry = current && copies.get(current);
      return entry?.geometry === value && entry.revision === geometryRevision(current) ? current : structuredClone(value);
    }
    if (Array.isArray(value)) {
      const byId = new Map((Array.isArray(current) ? current : []).filter(item => item?.id != null).map(item => [String(item.id), item]));
      return value.map((item, index) => restore(item, item?.id != null ? byId.get(String(item.id)) : current?.[index]));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) return structuredClone(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item, current?.[key])]));
  }
  return { clone, restore, clear: () => { copies = new WeakMap(); } };
}

/** Test-only adapter for retired editor autosave formats; not a GIS data compiler. */
export function createProjectSerializer(options={}) {
  const template=createProjectTemplateCompiler(options);
  const copies=createGeometrySnapshotPool();
  function buildAutosave() {
    const snapshot=options.readSnapshot();
    if(snapshot.fullAutosave)return {...template.buildProject(snapshot,copies.clone),format:'pandolab-autosave-full'};
    assertProjectBaselineFingerprint(snapshot.baseDatasetFingerprint);
    const {territorialEntities,...fields}=template.projectContent(snapshot,copies.clone);
    assertCurrentProjectSchema({format:'pandolab-project-state',...template.projectHeader(snapshot),...fields,territorialEntities});
    return {format:'pandolab-autosave-delta',...template.projectHeader(snapshot),...fields,
      baseDatasetFingerprint:snapshot.baseDatasetFingerprint,
      entityDelta:{changed:normalizeTerritorialIdentities(snapshot.entityDelta?.changed||[]),removedIds:[...(snapshot.entityDelta?.removedIds||[])]}};
  }
  return Object.freeze({buildProject:template.buildProject,buildAutosave});
}
