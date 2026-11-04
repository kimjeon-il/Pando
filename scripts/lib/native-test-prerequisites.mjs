// Application checks use the same targets, SDK pins and package owners as
// gis-native-hydro.yml and gis-historical-native.yml. These are tool builds only.
const build=(directory,targets,parallel=2)=>['cmake','--build',directory,'--config','Release','--target',...targets,'--parallel',String(parallel)];
const configure=(source,directory,...options)=>['cmake','-S',source,'-B',directory,...options];
const native=(target,directory,sourceModule,sourceExport,packageScript,commands,extra=[])=>({
  commands,artifact:{target,directory,executable:'pando-'+target,sourceModule,sourceExport},
  package:['node',packageScript,'--binary',commands.at(-1)[2]+'/pando-'+target,'--directory',directory,...extra],
});

export const nativeTestRecipes=Object.freeze({
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
  'map-review':native('map-review','build-native/map-review/artifact','tools/reference-analysis/review-masks.mjs','reviewMaskSourceFiles','tools/reference-analysis/package-native-review.mjs',[
    configure('tools/cpp/map-review','build-native/map-review/native'),build('build-native/map-review/native',['pando-map-review']),
  ]),
  'map-preview':native('map-preview','build-native/map-preview/artifact','tools/map-image/native-preview.mjs','mapPreviewSourceFiles','tools/map-image/package-preview.mjs',[
    configure('tools/cpp/map-preview','build-native/map-preview/native'),build('build-native/map-preview/native',['pando-map-preview']),
  ]),
  'map-evaluation':native('map-evaluation','build-native/map-evaluation/artifact','tools/reference-analysis/native-evaluation.mjs','evaluationSourceFiles','tools/reference-analysis/package-native-evaluation.mjs',[
    configure('tools/cpp/map-evaluation','build-native/map-evaluation/native'),build('build-native/map-evaluation/native',['pando-map-evaluation']),
  ]),
  'terrain-dem-gutters':native('terrain-dem-gutters','build-native/terrain-dem-gutters/artifact','tools/gis/terrain-dem-gutters.mjs','terrainDemGutterSources','tools/gis/package-terrain-dem-gutters.mjs',[
    configure('tools/cpp/terrain-dem-gutters','build-native/terrain-dem-gutters','-DCMAKE_BUILD_TYPE=Release'),
    build('build-native/terrain-dem-gutters',['pando-terrain-dem-gutters']),
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
  'publisher-pdf':{
    ...native('publisher-pdf','build-native/map-pdf/publisher-artifact','tools/reference-analysis/native-publisher-pdf.mjs','publisherPdfSourceFiles','tools/reference-analysis/package-native-publisher-pdf.mjs',[
      configure('tools/cpp/map-pdf/publisher','build-native/map-pdf/publisher-native','-DPANDO_MUPDF_SDK_ROOT={root}/build-native/map-pdf/sdk/pymupdf','-DCMAKE_BUILD_TYPE=Release'),
      build('build-native/map-pdf/publisher-native',['pando-publisher-pdf']),
    ],['--sdk','build-native/map-pdf/sdk/pymupdf']),
    runtime:{path:'build-native/map-pdf/publisher-artifact/libmupdf.so.26.11',sha256:'2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791'},
  },
  'mupdf':{sdk:{
    url:'https://files.pythonhosted.org/packages/4f/bf/6e02e3d84b32c137c71a0a3dcdba8f2f6e9950619a3bc272245c7c06a051/pymupdf-1.26.6-cp310-abi3-manylinux_2_28_x86_64.whl',
    sha256:'7777d0b7124c2ebc94849536b6a1fb85d158df3b9d873935e63036559391534c',
    archive:'build-native/map-pdf/mupdf-sdk.zip',destination:'build-native/map-pdf/sdk',maximumBytes:100000000,
    runtime:{path:'build-native/map-pdf/sdk/pymupdf/libmupdf.so.26.11',sha256:'2802c2bfedc5b2f4381d93dc2367c9987fa307fabc45c7a041d819c950cc5791'},
  }},
  'torch':{sdk:{
    url:'https://download.pytorch.org/libtorch/cpu/libtorch-cxx11-abi-shared-with-deps-2.7.1%2Bcpu.zip',
    sha256:'63d572598c8d532128a335018913e795c1bbb32602ce378896dc8cfbb5590976',
    archive:'build-native/reference-analysis/libtorch.zip',destination:'build-native/reference-analysis',maximumBytes:200000000,
    extracted:'build-native/reference-analysis/libtorch',minimumFreeBytes:9663676416,runtimeVersion:'2.7.1',
  }},
  'reference-model':{commands:[
    configure('tools/cpp','build-native/reference-analysis/native','-G','Ninja','-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_PREFIX_PATH={root}/build-native/reference-analysis/libtorch','-DPANDO_BUILD_COUNTRY_VALIDATOR=OFF','-DPANDO_BUILD_REFERENCE_MODEL=ON'),
    build('build-native/reference-analysis/native',['pando-reference-infer','pando-reference-training-proof','pando-reference-onnx-export'],1),
  ],binaries:['build-native/reference-analysis/native/pando-reference-infer','build-native/reference-analysis/native/pando-reference-training-proof',
    'build-native/reference-analysis/native/pando-reference-onnx-export']},
  'reference-batch':{
    commands:[configure('tools/cpp/reference-analysis/training-step-test','build-native/reference-analysis/step-test','-DCMAKE_BUILD_TYPE=Release',
      '-DCMAKE_PREFIX_PATH={root}/build-native/reference-analysis/libtorch'),
    build('build-native/reference-analysis/step-test',['pando-reference-training-batch','reference-training-infer-fixture'],1)],
    artifact:{target:'reference-training-batch',directory:'build-native/reference-analysis/artifact-batch',executable:'pando-reference-training-batch',
      sourceModule:'tools/reference-analysis/native-infer.mjs',sourceExport:'referenceBatchSourceFiles'},
    package:['node','tools/reference-analysis/package-native-reference.mjs','--kind','training-batch','--binary','build-native/reference-analysis/step-test/pando-reference-training-batch',
      '--directory','build-native/reference-analysis/artifact-batch'],
    binaries:['build-native/reference-analysis/step-test/reference-training-infer-fixture'],
  },
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
