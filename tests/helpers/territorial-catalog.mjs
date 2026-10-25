import {normalizeTerritorialLibraryEntity} from "../../apps/editor/frontend/js/modules/territorial-library.js";
export function catalogEntity(raw) {
  return normalizeTerritorialLibraryEntity({schemaVersion:2,lifetime:{validFrom:null,validTo:null},...raw,
    geometryVersions:raw.geometryVersions.map(v=>({validFrom:null,validTo:null,certainty:'high',sourceId:'fixture',...v}))});
}
