// Compatibility adapter for historic autosave/Core tests only. GIS publication
// uses project-template-compiler.js; the deployed Viewer never imports this file.
import {createProjectTemplateCompiler} from '../../tools/gis/project-template-compiler.js';
import {assertCurrentProjectSchema,assertProjectBaselineFingerprint} from '../../shared/frontend/js/modules/project-state.js';
import {normalizeTerritorialIdentities} from '../../shared/frontend/js/modules/territorial-units.js';
import {createGeometrySnapshotPool} from '../../shared/frontend/js/modules/geometry-versions.js';
export {fingerprintProjectBaseline} from '../../shared/frontend/js/modules/project-baseline-fingerprint.js';

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
