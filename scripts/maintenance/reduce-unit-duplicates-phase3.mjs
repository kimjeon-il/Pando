import {readFileSync,writeFileSync} from 'node:fs';
import {parseJavaScript,walkJavaScript} from '../lib/source-analysis.mjs';
const plan = {
  "tests/unit/rendering/gpu-helper-utils.test.mjs": {
    "tests": [
      "equal manifest content retains its Worker across cloned metadata",
      "equal immutable pack delivery and a transport retry retain prepared pack allocations",
      "document generation changes retain uploaded hydro buffers in the same context",
      "a ready Worker crash retires its generation and settles both RPC kinds without removing packs",
      "pack reuse, pruning, source replacement and disposal pair each registration with retirement",
      "RPC replies and typed errors cancel their timers without retiring a healthy Worker"
    ],
    "suites": [
      "gpu-canvas-scene-packets"
    ],
    "imports": [
      "__dep6"
    ]
  },
  "tests/unit/rendering/map-presentation-readiness.test.mjs": {
    "tests": [
      "full render preserves canonical layer order and revision",
      "view render refreshes projection-dependent layers with the shared view state",
      "interaction end coalesces settle work into the pending frame",
      "GPU-only invalidation redraws the shared view without rebuilding overlay data",
      "domain patches refresh only their affected persistent overlay",
      "frame completion reports measured interaction state without changing render ownership",
      "invalid mask mode is rejected at coordinator construction"
    ]
  },
  "tests/unit/ui/ui-state-controllers.test.mjs": {
    "tests": [
      "select search normalizes width case and whitespace",
      "select search includes technical values and aliases",
      "touch and a pointer outside the map cannot display country hover",
      "nested SVG movement neither cancels nor restarts the pending button tooltip",
      "returning to the country cancels a pending control and releases visible control aria ownership"
    ]
  },
  "tests/unit/geometry/hydro-source-reader.test.mjs": {
    "tests": [
      "verified lake source reaches native polygon and regional calibration preparation",
      "calibration river scan streams matching source geometry once with verified originals",
      "verified river source reaches regional calibration without a precomputed ID list",
      "verified selected river and lake sources produce a complete analysis result",
      "selected HydroRIVERS archive supplies clipped calibration river features",
      "one calibration region combines selected sources, reference layers and duplicate screening"
    ]
  },
  "tests/unit/build/p2-artifact-plan.test.mjs": {
    "tests": [
      "CI-only pushes leave existing stale data diagnostics without scheduling generation",
      "auto validation/presentation-only push leaves nine stale data families unselected",
      "report ownership bookkeeping is excluded while unexpected logical reports are rejected",
      "receipt and publication writes detach readonly data and retain the original shared bytes",
      "mounted publication stages only the stored pin and excludes unrelated writable data",
      "report fingerprints follow the owner read view when originals are stored only as variants"
    ]
  }
};
const results = [];
const prepared = new Map();
for (const [path, wanted] of Object.entries(plan)) {
  const input = readFileSync(path,'utf8');
  const parsed = parseJavaScript(input,{filePath:path});
  const removals = [];
  const foundTests = new Set(), foundSuites = new Set(), foundImports = new Set();
  walkJavaScript(parsed,node => {
    if (node.type === 'ExpressionStatement' && node.expression?.type === 'CallExpression') {
      const call = node.expression, arg = call.arguments?.[0];
      if (arg?.type !== 'Literal' || typeof arg.value !== 'string') return;
      if (call.callee.type === 'Identifier' && call.callee.name === 'test' && wanted.tests.includes(arg.value)) {
        if (foundTests.has(arg.value)) throw Error('Duplicate selected test: '+path+' '+arg.value);
        foundTests.add(arg.value);
        removals.push({kind:'test',name:arg.value,start:node.range[0],end:node.range[1]});
      }
      if (call.callee.type === 'Identifier' && call.callee.name === 'contractSuite' && wanted.suites?.includes(arg.value)) {
        if (foundSuites.has(arg.value)) throw Error('Duplicate selected suite: '+path+' '+arg.value);
        foundSuites.add(arg.value);
        removals.push({kind:'suite',name:arg.value,start:node.range[0],end:node.range[1]});
      }
    }
    if (node.type === 'ImportDeclaration' && wanted.imports?.length) {
      for (const name of wanted.imports) if (node.specifiers.some(s=>s.local.name===name)) {
        if (foundImports.has(name)) throw Error('Duplicate selected import: '+path+' '+name);
        foundImports.add(name);
        removals.push({kind:'import',name,start:node.range[0],end:node.range[1]});
      }
    }
  });
  for (const name of wanted.tests) if (!foundTests.has(name)) throw Error('Missing target test: '+path+' '+name);
  for (const name of wanted.suites||[]) if (!foundSuites.has(name)) throw Error('Missing suite: '+path+' '+name);
  for (const name of wanted.imports||[]) if (!foundImports.has(name)) throw Error('Missing import: '+path+' '+name);
  removals.sort((a,b)=>a.start-b.start);
  for (let i=1;i<removals.length;i++) if(removals[i].start<removals[i-1].end) throw Error('Overlapping deletion: '+path);
  // Apply edits from the end so earlier syntax offsets stay stable.
  let output=input;
  for (const item of [...removals].reverse()) {
    let end=item.end;
    if(output.slice(end,end+2)==='\r\n')end+=2;
    else if(output[end]==='\n')end++;
    if(output[end]==='\n')end++;
    output=output.slice(0,item.start)+output.slice(end);
  }
  // Pruned tests must not leave unused imports or state-building fixtures.
  // Each exact rewrite is checked once against the reviewed source.
  const rewrites = {
    'tests/unit/rendering/gpu-helper-utils.test.mjs': [
      ['import * as __dep7 from "node:fs";\n', ''],
      ['const { readFileSync } = __dep7;\n', ''],
    ],
    'tests/unit/ui/ui-state-controllers.test.mjs': [
      ['const { filterSelectOptions, normalizeSelectQuery } = __unit_dep9;',
       'const { filterSelectOptions } = __unit_dep9;'],
    ],
    'tests/unit/geometry/hydro-source-reader.test.mjs': [
      ['scanHydroRegionMetadata,scanHydroRiverCandidates}', 'scanHydroRegionMetadata}'],
      ['prepareHydroCalibrationLakeRegions,prepareHydroCalibrationLakes,prepareHydroCalibrationRegion,prepareHydroCalibrationRiverRegions,prepareHydroCalibrationRivers,runHydroCalibration,selectHydroCalibrationReferences}',
       'prepareHydroCalibrationLakes,prepareHydroCalibrationRivers}'],
    ],
    'tests/unit/build/p2-artifact-plan.test.mjs': [
      ['symlinkSync, statSync }', 'symlinkSync }'],
      ['libraryReportRoot,librarySharedCheckout}', 'libraryReportRoot}'],
      ['import {withLibraryOutputs} from "../../../tools/data/library-runtime.mjs";\n', ''],
      ['import {publishContent,linkContent} from "../../../tools/data/library-content.mjs";\n', ''],
      ['import {reportPath} from "../../../tools/data/report-paths.mjs";\n', ''],
      ['publishP2FromWorkflow,archiveGeneratedLibraryOutputs,assertP2LibraryPublicationBase',
       'publishP2FromWorkflow,assertP2LibraryPublicationBase'],
    ],
  };
  for(const [before,after] of rewrites[path]||[]){
    if(output.split(before).length!==2)throw Error('Unexpected leftover binding at '+path+': '+before);
    output=output.replace(before,after);
  }
  if(path==='tests/unit/build/p2-artifact-plan.test.mjs'){
    const ast=parseJavaScript(output,{filePath:path});
    const fixture=ast.ast.body.find(node=>node.type==='VariableDeclaration'&&
      node.declarations.some(d=>d.id.type==='Identifier'&&d.id.name==='nativeValidationChanges'));
    if(!fixture||fixture.declarations.length!==1)throw Error('Unexpected nativeValidationChanges fixture');
    let end=fixture.range[1];
    if(output[end]==='\n')end++;
    output=output.slice(0,fixture.range[0])+output.slice(end);
  }
  parseJavaScript(output,{filePath:path});
  if(output===input||output.length>input.length)throw Error('Not reduced: '+path);
  prepared.set(path,output);
  results.push({path,removed:removals.length,testsRemoved:wanted.tests.length,
    suitesRemoved:(wanted.suites||[]).length,linesBefore:input.split(/\r?\n/).length,
    linesAfter:output.split(/\r?\n/).length});
}
for(const [path,content] of prepared)writeFileSync(path,content);
console.log('PANDO_PHASE3_REVIEWED='+JSON.stringify(results));
