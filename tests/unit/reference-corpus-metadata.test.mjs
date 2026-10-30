import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {validateCorpusMetadata} from '../../tools/reference-analysis/reviewed-corpus.mjs';

const sheet={id:'one',familyId:'family',editionId:'edition',duplicateGroup:'one',split:'train',
  image:'images/one.png',annotations:'annotations/one.json',sha256:'a'.repeat(64),language:'eng',
  script:'Latin',mapKind:'color',source:{url:'https://example.test/one',license:'CC0'}};

test('corpus metadata distinguishes independent review from explicitly training-only data',()=>{
  const reviewed={schemaVersion:1,sheets:[sheet]},training={...reviewed,trainingOnly:true};
  assert.equal(validateCorpusMetadata(reviewed),reviewed);
  assert.equal(validateCorpusMetadata(training,{trainingOnly:true}),training);
  assert.throws(()=>validateCorpusMetadata(training),/training.only/i);
  assert.throws(()=>validateCorpusMetadata(reviewed,{trainingOnly:true}),/training.only/i);
  assert.throws(()=>validateCorpusMetadata({...training,sheets:[{...sheet,split:'test'}]},{trainingOnly:true}),/training.only/i);
});

test('corpus metadata rejects duplicate identities, split leakage and unsafe provenance',()=>{
  const check=sheets=>validateCorpusMetadata({schemaVersion:1,sheets});
  assert.throws(()=>check([sheet,sheet]),/unique/i);
  assert.throws(()=>check([sheet,{...sheet,id:'two',split:'test'}]),/familyId.*split/i);
  assert.throws(()=>check([{...sheet,image:'../escape'}]),/path|inside|escape/i);
  assert.throws(()=>check([{...sheet,sha256:'not-a-hash'}]),/sha256/i);
  assert.throws(()=>check([{...sheet,sha256:'a'.repeat(64)+'\n'}]),/sha256/i);
  assert.throws(()=>check([{...sheet,language:'eng\n'}]),/language/i);
  assert.throws(()=>check([{...sheet,source:{url:'https://example.test'}}]),/license/i);
  assert.throws(()=>check([{...sheet,ocrLanguages:['missing']}]),/OCR/i);
});

test('corpus metadata stream reports success and errors without accepting malformed JSON',()=>{
  for(const [input,ok] of [[JSON.stringify({value:{schemaVersion:1,trainingOnly:true,sheets:[sheet]},trainingOnly:true}),true],
    ['not-json',false]]){
    const result=spawnSync(process.execPath,['tools/reference-analysis/reviewed-corpus.mjs','--metadata-stream'],{input,encoding:'utf8'});
    assert.equal(result.status===0,ok);
    if(ok)assert.deepEqual(JSON.parse(result.stdout),{valid:true});else assert.ok(result.stderr);
  }
});

test('Python corpus caller preserves metadata acceptance and split rejection',
  {skip:!process.env.PANDO_PYTHON_ORACLE},()=>{
    const script=`import json,sys\nsys.path.insert(0,'tools/reference-analysis')\nfrom corpus import validate_corpus\ndata=json.load(sys.stdin)\ntry:\n validate_corpus(data)\n print('valid')\nexcept ValueError as e:\n print('error:'+str(e))`;
    for(const [value,pattern] of [
      [{schemaVersion:1,sheets:[sheet]},/^valid/],
      [{schemaVersion:1,trainingOnly:true,sheets:[sheet]},/^error:.*training.only/i],
      [{schemaVersion:1,sheets:[sheet,{...sheet,id:'two',split:'test'}]},/^error:.*familyId.*split/i],
    ]){
      const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(value),encoding:'utf8',windowsHide:true});
      assert.equal(result.status,0,result.stderr);assert.match(result.stdout,pattern);
    }
  });
