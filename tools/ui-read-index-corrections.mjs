import {readFileSync,writeFileSync} from 'node:fs';
function replace(path,before,after){const text=readFileSync(path,'utf8');if(!text.includes(before))throw Error('Reviewed source changed: '+path);writeFileSync(path,text.replace(before,after));}
// normalizeTerritorialIdentity deliberately retains geometry:null. Preserve
// that canonical coordinate-free sentinel; actual geometry remains invalid.
replace('src/data/builtin-country-files.js',"||Array.isArray(identity.properties)||Object.hasOwn(identity,'geometry'))fail();","||Array.isArray(identity.properties)||identity.geometry!=null)fail();");
// Byte-preservation is tested on a real, inactive future territorial identity,
// not the retired pre-timeline fixture that had no kind or lifetime.
replace('tests/unit/data/builtin-country-parts.test.mjs',"properties:{name:'Big',padding:","properties:{name:'Big',entityKind:'general',padding:");
replace('tests/unit/data/builtin-country-parts.test.mjs',"timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[]","timelineRecords:{schemaVersion:3,lifetimes:[{id:'life-big',objectRef:{domain:'territorial',id:'state:big'},validFrom:'2030-01-01',validTo:null}],geometryBindings:[]");
replace('tests/unit/data/builtin-country-parts.test.mjs',"coverage:[{validFrom:null,validTo:null}]","coverage:[{validFrom:'2030-01-01',validTo:null}]");
