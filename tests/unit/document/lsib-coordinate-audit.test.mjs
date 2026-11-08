import { describe as contractSuite } from 'node:test';
import * as __source_dep0 from "node:test";
import * as __source_dep1 from "node:assert/strict";
import * as __source_dep2 from "../../../tools/gis/lsib-coordinate-audit.mjs";
import * as __source_dep3 from "../../../tools/gis/lsib-exclusion.mjs";
import * as __source_dep4 from "node:fs";
import * as __source_dep5 from "node:path";
import * as __source_dep6 from "node:os";
import * as __source_dep7 from "node:crypto";
import * as __source_dep8 from "../../../tools/gis/apply-lsib-supplement.mjs";
contractSuite("lsib-coordinate-audit", () => {
const test = __source_dep0.default;
const assert = __source_dep1.default;
const { targetCoordinateKeys, indexLsibCoordinates, auditLsibGeometry, coordinateChainHash } = __source_dep2;


const ref={properties:{ID:'line',CC1_GENC3:'AAA',CC2_GENC3:'BBB',STATUS:'International Boundary'},geometry:{type:'LineString',coordinates:[[0,0],[1,0],[2,0],[3,0],[4,0]]}};
const polygon=points=>({type:'Polygon',coordinates:[[...points,[4,3],[0,3],points[0]]]});
function audit(g,digits=null){return auditLsibGeometry(g,indexLsibCoordinates([ref],targetCoordinateKeys([g],digits),{digits}));}
test('consecutive original coordinates match in either ring direction',()=>{
 const points=[[0,0],[1,0],[2,0],[3,0],[4,0]],a=audit(polygon(points)),b=audit(polygon([...points].reverse()));
 assert.equal(a.chains.filter(x=>x.kind==='consecutive-original-chain').length,1);assert.equal(a.chains[0].vertices,5);assert.equal(a.chains[0].coordinateHash,b.chains[0].coordinateHash);assert.equal(a.chains[0].exactNumeric,true);
});
test('retained subset is not called unchanged original detail; isolated contacts do not count',()=>{
 const x=audit(polygon([[0,0],[2,0],[4,0]]));assert.equal(x.chains[0].kind,'retained-original-subsequence');assert.equal(x.chains.some(x=>x.kind==='consecutive-original-chain'),false);
 assert.equal(audit(polygon([[0,0],[4,0]])).chains.length,0);assert.equal(audit(polygon([[0,0],[.5,1]])).chains.length,0);
});
test('rounding correspondence is separate from strict numeric identity and Monaco is excluded',()=>{
 const g=polygon([[0.00000001,0],[1.00000001,0],[2.00000001,0]]);assert.equal(audit(g).chains.length,0);const r=audit(g,6);assert.equal(r.chains[0].normalization,'decimal-6');assert.equal(r.chains[0].exactNumeric,false);
 const m={...ref,properties:{...ref.properties,CC2_GENC3:'MCO'}};assert.equal(indexLsibCoordinates([m],targetCoordinateKeys([g])).parts.size,0);assert.equal(coordinateChainHash([[1,0],[2,0]]),coordinateChainHash([[2,0],[1,0]]));
});

test('ordered retained anchors survive inserted target points without becoming an exact chain',()=>{
 const g=polygon([[0,0],[.5,.1],[2,0],[2.5,.1],[4,0]]),r=audit(g);
 assert.equal(r.chains.some(c=>c.kind==='consecutive-original-chain'),false);
 assert.equal(r.chains[0].kind,'retained-original-subsequence');assert.equal(r.chains[0].retainedOriginalVertices,3);assert.equal(r.chains[0].vertices,5);assert.equal(r.chains[0].insertedOrDifferentVertices,2);
});

test('ring rotation and reversal cannot split a three-vertex original chain at the closing seam',()=>{
 const open=[[0,0],[1,0],[2,0],[4,3],[0,3]];let expected;
 for(let n=0;n<open.length;n++)for(const reverse of[false,true]){let p=[...open.slice(n),...open.slice(0,n)];if(reverse)p.reverse();const r=audit({type:'Polygon',coordinates:[[...p,p[0]]]});assert.equal(r.chains.length,1);assert.equal(r.chains[0].vertices,3);expected??=r.chains[0].coordinateHash;assert.equal(r.chains[0].coordinateHash,expected);}
});

test('an inserted nonmatching pivot cannot split a cyclic retained subsequence',()=>{const open=[[0,0],[-1,-.1],[1,0],[2,0],[4,3],[0,3]];for(let n=0;n<open.length;n++)for(const reverse of[false,true]){let p=[...open.slice(n),...open.slice(0,n)];if(reverse)p.reverse();const r=audit({type:'Polygon',coordinates:[[...p,p[0]]]});const chain=r.chains.find(c=>c.kind==='retained-original-subsequence');assert.ok(chain);assert.equal(chain.retainedOriginalVertices,3);assert.equal(chain.vertices,4);assert.equal(chain.insertedOrDifferentVertices,1);assert.deepEqual([...chain.referenceIndices].sort((a,b)=>a-b),[0,1,2]);}});
});
contractSuite("gis-lsib-exclusion", () => {
const assert = __source_dep1.default;
const test = __source_dep0.default;
const { classifyLSIBExclusion } = __source_dep3;




const ordinary={RANK:'1',STATUS:'International Boundary',NOTES:''};
test('LSIB special lines and disputed or uncertain ownership are withheld in the original order',()=>{
  const cases=[
    [ordinary,false,null],[ordinary,true,'existing-disputed-territory-or-protected-country-pair'],
    [{...ordinary,RANK:'2'},true,'special-or-separation-line'],
    [{...ordinary,STATUS:'Line of Control'},false,'special-or-separation-line'],
    ...['Uncertain alignment','Condominium','neutral zone','Invernada'].map(NOTES=>[{...ordinary,NOTES},false,'uncertain-or-joint-sovereignty']),
    [{...ordinary,NOTES:'River island sovereignty disputed'},false,'river-island-sovereignty-needs-independent-review'],
    [{...ordinary,NOTES:'Uncertain island sovereignty'},false,'uncertain-or-joint-sovereignty'],
  ];
  for(const [properties,disputed,expected] of cases)assert.equal(classifyLSIBExclusion(properties,disputed),expected);
  assert.throws(()=>classifyLSIBExclusion({...ordinary,NOTES:null},false),/note/i);
});
test('batch classification preserves source order and rejects malformed requests',()=>{
  const rows=[ordinary,{...ordinary,RANK:'2'},{...ordinary,NOTES:'island sovereignty'}];
  assert.deepEqual(rows.map(row=>[classifyLSIBExclusion(row,false),classifyLSIBExclusion(row,true)]),[[null,'existing-disputed-territory-or-protected-country-pair'],
    ['special-or-separation-line','special-or-separation-line'],
    ['river-island-sovereignty-needs-independent-review','existing-disputed-territory-or-protected-country-pair']]);
  assert.throws(()=>classifyLSIBExclusion(null,false),/properties/i);
});
});
contractSuite("lsib-display-version", () => {
const test = __source_dep0.default;
const assert = __source_dep1.default;
const fs = __source_dep4.default;
const path = __source_dep5.default;
const os = __source_dep6.default;
const { createHash } = __source_dep7;
const { applyLsibSupplement } = __source_dep8;








test('LSIB updates the open display version, independently of an undated historic representative',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lsib-display-period-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'countries'));fs.mkdirSync(path.join(root,'views'));
 const geometry={type:'Polygon',coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]]};
 const entity={schemaVersion:2,entityId:'state:TST',entityKind:'general',names:{ko:'Test'},sourceInfo:{title:'Test'},
  lifetime:{validFrom:'1900',validTo:null},metadata:{representativeGeometryVersionId:'closed'},
  geometryVersions:[{versionId:'closed',validFrom:'1900',validTo:'1950',geometry},
   {versionId:'open',validFrom:'1951',validTo:null,geometry}]};
 const bytes=JSON.stringify(entity);fs.writeFileSync(path.join(root,'countries/state-TST.json'),bytes);
 const view={schemaVersion:1,selections:[{entityId:entity.entityId,geometryVersionId:'open'}]};
 const viewPath=path.join(root,'views/world.json');fs.writeFileSync(viewPath,JSON.stringify(view));
 const change={entityId:entity.entityId,geometryVersionId:'open',geometry,sourceId:'ne+dos-lsib-11.4',
  inputFileSha256:createHash('sha256').update(bytes).digest('hex'),sourceAttributions:[],supplement:{coastline:'preserved'}};
 const candidate={schemaVersion:1,sourceId:'dos-lsib-11.4',changes:[change]};
 assert.deepEqual(applyLsibSupplement(candidate,{root,check:true}),{countries:1,applied:false});
 change.geometryVersionId='closed';
 assert.throws(()=>applyLsibSupplement(candidate,{root,check:true}),/Historical/);
 view.selections[0].geometryVersionId='closed';fs.writeFileSync(viewPath,JSON.stringify(view));
 assert.throws(()=>applyLsibSupplement(candidate,{root,check:true}),/Historical/);
 assert.equal(fs.readFileSync(path.join(root,'countries/state-TST.json'),'utf8'),bytes);
});

// Closed historical geometry must fail before source-chain processing.
test('Korean refinement rejects a closed explicitly selected version',async()=>{
 const {restoreChinesePaektuSource}=await import("../../../tools/build/build-korean-boundaries.mjs");
 const entity={geometryVersions:[{versionId:'closed',validTo:'1950'}]};
 const before=structuredClone(entity);
 assert.throws(()=>restoreChinesePaektuSource(entity,{features:[]},{features:[]},'closed'),/Missing open Chinese display geometry/);
 assert.deepEqual(entity,before);
});
});
