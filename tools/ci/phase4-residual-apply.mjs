// One-shot exact edits for the approved phase-4 task; retired after verification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
const touched=new Set();
function replace(path,before,after){
 const text=readFileSync(path,'utf8');
 assert.equal(text.split(before).length,2,'Expected one reviewed edit boundary: '+path+' '+before.slice(0,100));
 writeFileSync(path,text.replace(before,after));touched.add(path);
}
const storage='tools/library-data.mjs';
replace(storage,"import {compactDuplicatePacks} from './library-git.mjs';","import {compactDuplicatePacks} from './library-git.mjs';\nimport {runtimeArchiveIndex} from './library-runtime-index.mjs';");
replace(storage,'  if (existsSync(view)) throw Error(`Incomplete runtime view must be preserved: ${view}`);',"  // Archive retention is not a runtime download requirement.\n  index = runtimeArchiveIndex(index, entry => decodeArchiveEntry(libraryCheckout(root), entry, config.revision, {fetch}));\n  if (existsSync(view)) throw Error(`Incomplete runtime view must be preserved: ${view}`);");
replace(storage,"  const publicationBranch=reportData?'main':git(root,['symbolic-ref','--short','HEAD']);","  const runtimeFiles = reportData ? index.files : runtimeArchiveIndex(index, entry => decodeArchiveEntry(data.checkout, entry, libraryConfig(root).revision, {fetch:true})).files;\n  const publicationBranch=reportData?'main':git(root,['symbolic-ref','--short','HEAD']);");
replace(storage,"  for (const [path, entry] of Object.entries(index.files)) {\n    if (path.startsWith('reports/')) continue;","  for (const [path, entry] of Object.entries(index.files)) {\n    if (path.startsWith('reports/')) continue;\n    // A filtered archived asset is not a user deletion.\n    if (!Object.hasOwn(runtimeFiles, path) && !removed.has(path)) continue;");
const water='tools/gis/prepare-water-object-history.mjs';
replace(water,"import {finalizeBuiltinWorldFiles,writeBuiltinWorldPublication} from '../build-builtin-world.mjs';\n",'');
const waterText=readFileSync(water,'utf8');
const start=waterText.indexOf('/** Change only the current common target contract, without recomputing GIS. */');
const end=waterText.indexOf('if(process.argv[1]',start);
assert.ok(start>0&&end>start);replace(water,waterText.slice(start,end),'');
replace(water,'  const countries=prepareCommonCountryTargets(root);',"  // The schema-3 country migration is complete; water work never rewrites countries.\n  const countries={countryContractFiles:0,geometryRegeneration:false};");
const readers=[
 ['tests/unit/gis-2000-2026-generated-attributes.test.mjs','fs.readFileSync(new URL(row.file,root))','readBuiltinCountryStoredBytes(row,file=>fs.readFileSync(new URL(file,root)))'],
 ['tests/unit/post-2000-generated-world-display.test.mjs','fs.readFileSync(new URL(entry.file,root))','readBuiltinCountryStoredBytes(entry,file=>fs.readFileSync(new URL(file,root)))'],
 ['tests/unit/source-date-cut-normalization.test.mjs','fs.readFileSync(new URL(record.file,world))','readBuiltinCountryStoredBytes(record,file=>fs.readFileSync(new URL(file,world)))'],
 ['tests/unit/ussr-1922-selection.test.mjs','readFileSync(new URL(row.file,base))','readBuiltinCountryStoredBytes(row,file=>readFileSync(new URL(file,base)))'],
 ['tests/unit/soviet-republic-transitions.test.mjs','readFileSync(new URL(index.entities.find(row=>row.entityId===id).file,directory))','readBuiltinCountryStoredBytes(index.entities.find(row=>row.entityId===id),file=>readFileSync(new URL(file,directory)))'],
];
for(const [path,before,after]of readers){
 replace(path,before,after);
 replace(path,"import test from 'node:test';","import test from 'node:test';\nimport {readBuiltinCountryStoredBytes} from '../../tools/builtin-country-bytes.mjs';");
}
replace('tests/unit/ussr-1922-selection.test.mjs','parentRelations.find(row=>row.entityId===id)','parentRelations.find(row=>row.objectRef?.domain===\'territorial\'&&row.objectRef.id===id)');
const pages='tests/helpers/frontend-pages-fixture.mjs';
replace(pages,"put(root,'assets/data/builtin-world/generated/v1/index.json','{\"entities\":[],\"transport\":{\"url\":\"data.bin\"}}');","put(root,'assets/data/builtin-world/generated/v1/index.json','{\"schema\":\"pandolab-builtin-world\",\"schemaVersion\":2,\"storageLayout\":\"country-files-v1\",\"entities\":[]}');");
replace(pages,"  put(root,'assets/data/builtin-world/generated/v1/data.bin','history');\n",'');
replace('tests/browser/territorial-names.spec.mjs',"'**/assets/data/builtin-world/generated/v1/transport/**'","'**/assets/data/builtin-world/generated/v1/**'");
const stage='apps/editor/tests/stage.test.mjs';
replace(stage,'the verification fixture loads through the current builtin country transport','the verification fixture loads through independent builtin country files');
replace(stage,"  await assert.rejects(stat(join(ordinary.directory, 'shell/transport')), /ENOENT/);","  for(const folder of ['transport','countries','country-parts'])await assert.rejects(stat(join(ordinary.directory, 'shell/'+folder)), /ENOENT/);");
replace('docs/territorial-entity-storage.md','# Country object storage — current contract\n',"# Country object storage — current contract\n\nThe 2026-11-01 builtin publication uses country-files-v1 throughout generation,\nloading, caching, Web/App packaging and runtime preparation. Countries exceeding\n512 KiB use bounded country-owned parts; no all-country transport is required.\nHistorical archive entries remain preserved but are not runtime dependencies.\nSee development/builtin-country-residuals.md for the phase-4 boundary and tests.\n");
for(const path of touched)console.log('Reviewed exact edit: '+path);
// These files exist only to apply this approved patch, not as a permanent publisher.
for(const path of ['tools/ci/phase4-residual-apply.mjs','.github/workflows/builtin-country-phase4-apply.yml']){unlinkSync(path);touched.add(path);}
writeFileSync('/tmp/pando-phase4-paths.json',JSON.stringify([...touched]));
