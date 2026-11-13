// Application checks use the same targets, SDK pins and package owners as
// gis-native-hydro.yml and gis-historical-native.yml. These are tool builds only.
const build=(directory,targets,parallel=2)=>['cmake','--build',directory,'--config','Release','--target',...targets,'--parallel',String(parallel)];
const configure=(source,directory,...options)=>['cmake','-S',source,'-B',directory,...options];
const native=(target,directory,sourceModule,sourceExport,packageScript,commands,extra=[])=>({
  commands,artifact:{target,directory,executable:'pando-'+target,sourceModule,sourceExport},
  package:['node',packageScript,'--binary',commands.at(-1)[2]+'/pando-'+target,'--directory',directory,...extra],
});

export const nativeTestRecipes=Object.freeze({
  // Reuse fixed CMake owners; CTest runs as its separate registered check.
  // No artifact packaging is needed for these in-job test executables.
  'spherical-polygon-tests':{commands:[
    ['cmake','--preset','pando-gis-tools'],
    build('build-native/p1/pando-gis-tools',['pando-spherical-polygon-tests']),
  ]},
  'polygon-mesh-tests':{commands:[
    configure('tools/build/native','build-native/geometry-core','-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTING=ON'),
    build('build-native/geometry-core',['polygon_mesh_tests']),
  ]},
  'document-session-tests':{commands:[
    configure('tools/build/native','build-native/geometry-core','-DCMAKE_BUILD_TYPE=Release','-DBUILD_TESTING=ON'),
    build('build-native/geometry-core',['document_session_tests']),
  ]},
  'hydro-calibration':native('hydro-calibration','build-native/hydro-calibration/artifact','tools/gis/hydro-calibration-native.mjs','hydroCalibrationSources','tools/gis/package-hydro-calibration.mjs',[
    configure('tools/cpp/hydro-calibration','build-native/hydro-calibration/native','-DCMAKE_BUILD_TYPE=Release'),
    build('build-native/hydro-calibration/native',['pando-hydro-calibration']),
  ]),
  'hydro-point-screen':native('hydro-point-screen','build-native/hydro-point-screen/artifact','tools/gis/hydro-point-screen-native.mjs','hydroPointScreenSources','tools/gis/package-hydro-point-screen.mjs',[
    configure('tools/cpp','build-native/hydro-point-screen','-DCMAKE_BUILD_TYPE=Release','-DPANDO_BUILD_COUNTRY_VALIDATOR=OFF','-DPANDO_BUILD_HYDRO_POINT_SCREEN=ON'),
    build('build-native/hydro-point-screen',['pando-hydro-point-screen']),
  ]),
  'map-image':native('map-image','build-native/map-image/artifact','tools/map-image/native-resample.mjs','mapImageSourceFiles','tools/map-image/package-native.mjs',[
    configure('tools/cpp','build-native/map-image','-DPANDO_BUILD_COUNTRY_VALIDATOR=OFF','-DPANDO_BUILD_MAP_IMAGE=ON'),
    build('build-native/map-image',['pando-map-image']),
  ]),
  'map-preview':native('map-preview','build-native/map-preview/artifact','tools/map-image/native-preview.mjs','mapPreviewSourceFiles','tools/map-image/package-preview.mjs',[
    configure('tools/cpp/map-preview','build-native/map-preview/native'),build('build-native/map-preview/native',['pando-map-preview']),
  ]),
  'terrain-dem-gutters':native('terrain-dem-gutters','build-native/terrain-dem-gutters/artifact','tools/gis/terrain-dem-gutters.mjs','terrainDemGutterSources','tools/gis/package-terrain-dem-gutters.mjs',[
    configure('tools/cpp/terrain-dem-gutters','build-native/terrain-dem-gutters','-DCMAKE_BUILD_TYPE=Release'),
    build('build-native/terrain-dem-gutters',['pando-terrain-dem-gutters']),
  ]),
  'terrain-dem-encode':native('terrain-dem-encode','build-native/terrain-dem-encode/artifact','tools/gis/terrain-dem-encode.mjs','terrainDemEncodeSources','tools/gis/package-terrain-dem-encode.mjs',[
    configure('tools/cpp/terrain-dem-encode','build-native/terrain-dem-encode/native','-DCMAKE_BUILD_TYPE=Release'),
    build('build-native/terrain-dem-encode/native',['pando-terrain-dem-encode']),
  ]),
  'terrain-dem-fill':native('terrain-dem-fill','build-native/terrain-dem-encode/fill-artifact','tools/gis/terrain-dem-source.mjs','terrainDemFillSources','tools/gis/package-terrain-dem-fill.mjs',[
    configure('tools/cpp/terrain-dem-fill','build-native/terrain-dem-encode','-DCMAKE_PREFIX_PATH={root}/build-native/terrain-dem-gdal/sdk','-DCMAKE_BUILD_TYPE=Release'),
    build('build-native/terrain-dem-encode',['pando-terrain-dem-fill']),
  ]),
  'terrain-dem-tint':native('terrain-dem-tint','build-native/terrain-dem-tint/artifact','tools/gis/terrain-dem-tint.mjs','terrainDemTintSources','tools/gis/package-terrain-dem-tint.mjs',[
    configure('tools/cpp/terrain-dem-tint','build-native/terrain-dem-tint','-DCMAKE_PREFIX_PATH={root}/build-native/terrain-dem-gdal/sdk','-DCMAKE_BUILD_TYPE=Release'),
    build('build-native/terrain-dem-tint',['pando-terrain-dem-tint']),
  ]),
  'map-pdf':{
    ...native('map-pdf','build-native/map-pdf/artifact','tools/map-image/native-pdf.mjs','mapPdfSourceFiles','tools/map-image/package-pdf.mjs',[
      configure('tools/cpp/map-pdf','build-native/map-pdf/native','-DPANDO_MUPDF_SDK_ROOT={root}/build-native/map-pdf/sdk/pymupdf'),
      build('build-native/map-pdf/native',['pando-map-pdf']),
    ],['--sdk','build-native/map-pdf/sdk/pymupdf']),
    runtime:{path:'build-native/map-pdf/artifact/libmupdf.so.26.11',sha256:'2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791'},
  },
  'mupdf':{sdk:{
    url:'https://files.pythonhosted.org/packages/4f/bf/6e02e3d84b32c137c71a0a3dcdba8f2f6e9950619a3bc272245c7c06a051/pymupdf-1.26.6-cp310-abi3-manylinux_2_28_x86_64.whl',
    sha256:'7777d0b7124c2ebc94849536b6a1fb85d158df3b9d873935e63036559391534c',
    archive:'build-native/map-pdf/mupdf-sdk.zip',destination:'build-native/map-pdf/sdk',maximumBytes:100000000,
    runtime:{path:'build-native/map-pdf/sdk/pymupdf/libmupdf.so.26.11',sha256:'2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791'},
  }},
  'territorial-recipe':{commands:[
    ['pkg-config','--exact-version=3.13.1','geos'],['pkg-config','--exact-version=9.5.1','proj'],
    configure('tools/cpp','build-native/territorial-recipe','-G','Ninja','-DPANDO_BUILD_COUNTRY_VALIDATOR=OFF','-DPANDO_BUILD_TERRITORIAL_RECIPE=ON'),
    build('build-native/territorial-recipe',['pando-territorial-recipe']),
  ].map(argv=>['micromamba','run','-n','pando-territorial-recipe',...argv]),binaries:['build-native/territorial-recipe/pando-territorial-recipe']},
  'german-natural-earth':{data:'german-natural-earth'},
  'caspian-oracle':{data:'caspian-oracle'},
});

export function nativeTestRecipe(id,{platform=process.platform,architecture=process.arch}={}) {
  if(!Object.hasOwn(nativeTestRecipes,id))throw Error('Unknown native test prerequisite: '+id);
  if(platform!=='linux'||architecture!=='x64')throw Error('Application native preparation requires Linux x64; use the existing platform-specific native workflow on other hosts');
  return nativeTestRecipes[id];
}
