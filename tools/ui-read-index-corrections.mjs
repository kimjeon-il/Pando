import {readFileSync,writeFileSync} from 'node:fs';
function replace(path,before,after){const text=readFileSync(path,'utf8');if(!text.includes(before))throw Error('Reviewed source changed: '+path);writeFileSync(path,text.replace(before,after));}
// normalizeTerritorialIdentity deliberately retains geometry:null. That is a
// coordinate-free identity, not a second geometry; non-null geometry remains
// invalid at this boundary.
replace('src/data/builtin-country-files.js',"||Array.isArray(identity.properties)||Object.hasOwn(identity,'geometry'))fail();","||Array.isArray(identity.properties)||identity.geometry!=null)fail();");
// The old oversized-descriptor fixture lacked the current domain kind. Its
// payload is still byte-preserved, but the real temporal selector requires it.
replace('tests/unit/data/builtin-country-parts.test.mjs',"properties:{name:'Big',padding:","properties:{name:'Big',entityKind:'general',padding:");
