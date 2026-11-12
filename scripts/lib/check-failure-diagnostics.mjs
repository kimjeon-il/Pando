// One bounded interpretation layer for application check results. A failing
// assertion is not proof of a product regression or an obsolete test.
export const CHECK_FAILURE_KINDS = Object.freeze({
  FUNCTIONAL: 'functional-regression',
  STALE: 'stale-test',
  ARTIFACT: 'artifact-mismatch',
  ENVIRONMENT: 'environment-error',
  UNDETERMINED: 'undetermined',
});

const normalize = value => String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
const diagnosticsText = ({error,stdout,stderr}={}) => {
  const text = [error,stderr,stdout].map(normalize).filter(Boolean).join('\n');
  // Keep a bounded prefix as well as the tail: setup errors are often first,
  // while the assertion and process status occur at the end.
  return text.length > 16000 ? text.slice(0,4000)+'\n…\n'+text.slice(-12000) : text;
};
const patterns = [
  {kind:CHECK_FAILURE_KINDS.ARTIFACT,rule:'artifact-source-identity',
    match:/PL-CORE-PREREQUISITE-STALE|compiled core source identity mismatch|WASM manifest stale|WASM (?:binary|JavaScript) artifact stale|core source identity is stale/i,
    action:'Rebuild or republish only the stale source-matched artifact; preserve the pinned input hash.'},
  {kind:CHECK_FAILURE_KINDS.ARTIFACT,rule:'artifact-digest',
    match:/\b(?:SHA-256|sha256|source fingerprint|sourceSha256)\b.{0,100}(?:mismatch|differs|stale|integrity)|(?:mismatch|differs|stale).{0,100}\b(?:SHA-256|sha256|source fingerprint|sourceSha256)\b|P2_ARTIFACT_(?:STALE|MISMATCH)/i,
    action:'Compare the generated file, declared source revision and immutable input pin before rebuilding.'},
  {kind:CHECK_FAILURE_KINDS.ENVIRONMENT,rule:'environment-process',
    match:/\b(?:ENOSPC|EMFILE|EACCES|EADDRINUSE|CHECK_HISTORY|PINNED_TOOLCHAIN_NODE_MAJOR|PANDO_REMOTE_ONLY_NATIVE_CI_REQUIRED)\b|\bspawn\s+(?:\S+\s+)?ENOENT\b|(?:command not found|executable not found|No space left on device)/i,
    action:'Restore the selected runner, toolchain, permissions, history or capacity before retrying the same check.'},
  {kind:CHECK_FAILURE_KINDS.STALE,rule:'stale-registered-test',
    match:/Unknown or retired selected check:|Missing registered test:|Unregistered test:|Missing direct test reference:/i,
    action:'Update the retired test or invocation to the currently registered contract; do not alter product assertions automatically.'},
];

function diagnosticEvidence(text,match) {
  const index = text.search(match);
  if(index<0)return [];
  const lineStart = text.lastIndexOf('\n',index);
  const lineEnd = text.indexOf('\n',index);
  const raw = text.slice(lineStart+1,lineEnd<0?undefined:lineEnd);
  // Do not include request tokens or query strings in exported CI evidence.
  return [raw.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g,'$1?[redacted]').slice(0,400)];
}

/** Report a rooted cause only when the available evidence justifies it. */
export function diagnoseCheckFailure(result={}, {confirmedCurrentContract=false}={}) {
  if(result.status==='passed')return null;
  const text=diagnosticsText(result),blocked=result.status==='blocked';
  if(blocked)return {
    kind:CHECK_FAILURE_KINDS.UNDETERMINED,confidence:'unconfirmed',
    rule:'blocked-prerequisite',evidence:result.prerequisites||[],
    action:'Inspect the failing prerequisite before attributing this blocked check to a product or test.',
  };
  for(const item of patterns)if(item.match.test(text))return {
    kind:item.kind,confidence:'confirmed',rule:item.rule,
    evidence:diagnosticEvidence(text,item.match),action:item.action,
  };
  if(confirmedCurrentContract&&/\bAssertionError\b|(?:Expected|Received):|expect\(.*\)\.to/i.test(text))
    return {kind:CHECK_FAILURE_KINDS.FUNCTIONAL,confidence:'verified-contract',
      rule:'verified-runtime-behavior',evidence:[],
      action:'Investigate the production behavior; the current observable contract was independently verified.'};
  return {kind:CHECK_FAILURE_KINDS.UNDETERMINED,confidence:'unconfirmed',
    rule:/AssertionError|expect\(|Expected:|Received:/.test(text)?'assertion-needs-review':'unclassified-failure',
    evidence:[],action:'Compare the observed runtime behavior with the current contract, test fixture and source-matched artifacts before assigning blame.'};
}

export function summarizeCheckDiagnostics(results=[], {phase='all',sourceCommit=null,dataRevision=null}={}) {
  const entries=results.filter(row=>row.status!=='passed').map(row=>({
    id:row.id,files:row.files||[],status:row.status,
    ...(row.exitCode==null?{}:{exitCode:row.exitCode}),
    ...(row.prerequisites?{prerequisites:row.prerequisites}:{}),
    diagnosis:row.diagnosis||diagnoseCheckFailure(row),
  }));
  const counts=Object.fromEntries(Object.values(CHECK_FAILURE_KINDS).map(value=>[value,0]));
  for(const entry of entries)counts[entry.diagnosis.kind]++;
  return {
    schema:'pando-check-failure-diagnostics-v1',
    phase,sourceCommit,dataRevision,
    status:entries.length?'failed-or-blocked':'no-failures-in-selected-checks',
    counts,entries,
  };
}
