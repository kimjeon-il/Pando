import {normalizeTerritorialLibraryEntity} from "../../tools/gis/territorial-library.js";
export function catalogEntity(raw) {
  return normalizeTerritorialLibraryEntity({schemaVersion:2,lifetime:{validFrom:null,validTo:null},...raw,
    geometryVersions:raw.geometryVersions.map(v=>({validFrom:null,validTo:null,certainty:'high',sourceId:'fixture',...v}))});
}
