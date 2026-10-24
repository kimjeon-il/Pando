import {TERRAIN_DEM_VERSION,selectTerrainManifestUrls,terrainRasterManifestUrl} from './terrain-manifest.js';
export const HYDRO_TOOL_CONFIG = Object.freeze({
      river: Object.freeze({ geometry: 'LineString', category: 'river', label: '강', color: '#3b82c4', prefix: 'river' }),
      lake: Object.freeze({ geometry: 'Polygon', category: 'lake', label: '호수', color: '#5aa9d6', prefix: 'lake' }),
    });

export const HYDRO_LAYER_META = Object.freeze({
      rivers_hydro: Object.freeze({ label: '강', shortLabel: '강', sourceLabel: 'HydroRIVERS', category: 'river', color: '#3b82c4' }),
      lakes_natural_earth: Object.freeze({ label: '호수', shortLabel: '호수', sourceLabel: 'Natural Earth', category: 'lake', color: '#5aa9d6' }),
    });

export const TERRAIN_OCEAN_REPRESENTATIVE = '#6aa8d2';


export const PHYSICAL_DATASET='HydroRIVERS 1.0 · Natural Earth 5.0.0 호수 · ETOPO 2022 DEM';
/** Same source/profile policy for browser and packaged application resources. */
export function createPhysicalSourceConfiguration({assetBaseUrl,dataRevision,resourceProfile,search=location.search,devManifest=globalThis.PANDOLAB_DEV_DEM_MANIFEST_URL}){
 const params=new URLSearchParams(search),dataBase=new URL('../data/',assetBaseUrl);
 const raster=terrainRasterManifestUrl(dataBase,dataRevision);
 const local=params.get('demTerrain')==='local'?`http://127.0.0.1:4174/terrain/v${TERRAIN_DEM_VERSION}/manifest.json`:null;
 const dev=devManifest||local?new URL(String(devManifest||local),location.href):null;
 const selection=selectTerrainManifestUrls({official:new URL(`https://kimjeon-il.github.io/PandoLab-library-data/terrain/v${TERRAIN_DEM_VERSION}/manifest.json`),
  raster,dev:resourceProfile==='map-data'?null:dev,preview:params.get('demTerrain')==='preview',
  rasterOnly:resourceProfile==='map-data'||params.get('demTerrain')==='raster',defaultDem:true});
 return Object.freeze({PHYSICAL_DATA_BASE_URL:dataBase,TERRAIN_RASTER_MANIFEST_URL:raster,TERRAIN_DEV_DEM_MANIFEST_URL:dev,
  TERRAIN_PRIMARY_MANIFEST_URL:selection.primary,TERRAIN_FALLBACK_MANIFEST_URL:selection.fallback,TERRAIN_SOURCE_CHOICE:selection.source});
}
