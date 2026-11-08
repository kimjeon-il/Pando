import {inspectReviewEvidence} from "../document/review-inspection.js";

const allowed = new Set([
  'e3-source-diff.json','e3-verification.json',
  'e3-pending-proposal.json','e3-output-manifest.json',
]);
const hex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
const invalid=message=>{throw Object.assign(new Error(message),{code:'PL-REVIEW-FILES'});};

/** User gesture only. Reads exact E3 JSON files and optionally verifies SHA receipts. */
export async function readReviewEvidenceFiles(files,{subtle=globalThis.crypto?.subtle}={}){
  const inputs=[...files];
  if(!inputs.length || inputs.length>4)invalid('E3 검수 파일 1~4개를 선택해야 합니다.');
  const names=new Set(),byName=new Map();
  for(const file of inputs){
    if(!allowed.has(file.name)||names.has(file.name)||typeof file.arrayBuffer!=='function'
      ||file.size<=0||file.size>12*1024*1024)
      invalid('중복되거나 지원하지 않는 검수 파일이 있습니다: '+String(file.name||''));
    names.add(file.name);
    const raw=new Uint8Array(await file.arrayBuffer());
    if(raw.byteLength!==file.size)invalid('읽은 파일 크기가 요청한 파일과 다릅니다.');
    let parsed;
    try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
    catch{invalid('검수 JSON 형식을 읽을 수 없습니다: '+file.name);}
    byName.set(file.name,{raw,parsed});
  }
  if(!byName.has('e3-source-diff.json'))invalid('e3-source-diff.json 변경 원문이 필요합니다.');
  const manifest=byName.get('e3-output-manifest.json')?.parsed??null;
  if(manifest){
    if(!subtle)invalid('SHA-256 검증은 보안 연결에서만 실행할 수 있습니다.');
    const records=manifest.files;
    if(!Array.isArray(records)||records.length<2||records.length>3)
      invalid('E3 산출물 체크섬 목록이 유효하지 않습니다.');
    const manifestNames=new Set();
    for(const row of records){
      if(!row||typeof row.name!=='string'||manifestNames.has(row.name)
        ||row.name==='e3-output-manifest.json'||!allowed.has(row.name)
        ||!/^[a-f0-9]{64}$/.test(row.sha256||'')||!Number.isSafeInteger(row.bytes))
        invalid('E3 체크섬 항목이 올바르지 않습니다.');
      manifestNames.add(row.name);
      const file=byName.get(row.name);
      if(!file||file.raw.byteLength!==row.bytes)invalid('E3 산출물 누락 또는 파일 크기 불일치: '+row.name);
      const actual=hex(await subtle.digest('SHA-256',file.raw));
      if(actual!==row.sha256)invalid('E3 산출물 SHA-256이 일치하지 않습니다: '+row.name);
    }
    if([...byName.keys()].some(x=>x!=='e3-output-manifest.json'&&!manifestNames.has(x)))
      invalid('E3 산출물 목록에 없는 파일이 포함됐습니다.');
  }
  const inspection=inspectReviewEvidence({
    diff:byName.get('e3-source-diff.json').parsed,
    verification:byName.get('e3-verification.json')?.parsed??null,
    proposal:byName.get('e3-pending-proposal.json')?.parsed??null,
    manifest,
  });
  return Object.freeze({inspection,checksumVerified:!!manifest});
}
