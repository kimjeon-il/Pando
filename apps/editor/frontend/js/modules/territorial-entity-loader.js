// Retired editor composition only. Data loading lives in tools/gis.
import {createTerritorialEntityLoader,createRepositoryTerritorialLoader} from "../../../../../tools/gis/territorial-entity-loader.js";
export {createTerritorialEntityLoader,createRepositoryTerritorialLoader} from "../../../../../tools/gis/territorial-entity-loader.js";

export async function openTerritorialLibraryAccess({repository=null,source,onSyncError}={}){
  if(!repository)return Object.freeze({loader:createTerritorialEntityLoader(source),editingRepository:null});
  if(typeof onSyncError!=='function')throw new TypeError('Native library access requires its synchronization error boundary.');
  await repository.open();
  try{await repository.sync();await repository.open();}catch(error){onSyncError(error);}
  return Object.freeze({loader:createRepositoryTerritorialLoader(repository),editingRepository:repository});
}
