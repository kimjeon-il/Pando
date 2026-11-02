// Windows verification builds only; ordinary review HTML never includes this file.
// Reports a native WebView2 map, actual Viewer Core write refusal and open E4 panel.
const runtime = globalThis.__TAURI_INTERNALS__;
const invoked = runtime?.invoke;
if(globalThis.PANDOLAB_NATIVE_REVIEW!==true
  ||globalThis.PANDOLAB_SHELL_VERIFICATION!==true
  ||typeof invoked!=='function')
  throw new Error('Windows reviewer verification requires the explicit native capability.');

let complete=false,checking=false;
const began=Date.now(),limit=180_000;
const watch=window.setInterval(()=>check().catch(error=>finish(false,{error:String(error)})),350);
async function finish(ok,observed){
  if(complete)return;
  complete=true;
  window.clearInterval(watch);
  const report={schema:'pandolab-windows-review-probe',phase:'read-only-map-ready',ok,
    observed:{...observed,elapsedMs:Date.now()-began}};
  await invoked(globalThis.__PANDOLAB_SHELL_AUTO__===true?'finish_probe':'write_diagnostic_report',{report});
}
async function check(){
  if(complete||checking)return;
  checking=true;
  try{
    const panel=document.getElementById('reviewPanel');
    const ready=document.getElementById('viewerStatus')?.dataset.ready==='true';
    if(!ready||panel?.hidden!==false){
      if(Date.now()-began>limit)await finish(false,{error:'Map frame or E4 panel did not become ready.'});
      return;
    }
    const verification=globalThis.__PANDOLAB_NATIVE_REVIEW_VERIFICATION__;
    if(!verification||typeof verification.capture!=='function')
      throw new Error('The native review Core verification port is missing.');
    const observed=await verification.capture();
    const valid=observed.readOnly===true&&observed.projection==='flat'&&observed.dataReady===true
      &&observed.panelOpen===true&&observed.hasReviewLoad===true
      &&observed.editorDomAbsent===true&&observed.canUndo===false
      &&observed.mutationBlocked===true;
    await finish(valid,valid?observed:{...observed,error:'Native read-only acceptance contract not met.'});
  }finally{checking=false;}
}
window.addEventListener('pandolab:error',event=>{finish(false,{error:String(event.detail||'Map startup failed')})
  .catch(error=>console.error('[PL-E5-REVIEW-PROBE]',error));},{once:true});
check().catch(error=>finish(false,{error:String(error)}));
