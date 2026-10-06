import {normalizeTerritorialLibraryEntity} from '../../assets/js/modules/territorial-library.js';
export function catalogEntity(raw) {
  return normalizeTerritorialLibraryEntity({schemaVersion:2,lifetime:{validFrom:null,validTo:null},...raw,
    geometryVersions:raw.geometryVersions.map(v=>({validFrom:null,validTo:null,datePrecision:'current',certainty:'high',sourceId:'fixture',...v}))});
}
