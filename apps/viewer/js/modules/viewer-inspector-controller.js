/**
 * Single Web Viewer inspector lifecycle. No document commands, GIS writes,
 * browser storage or background review work are owned by this controller.
 * The expensive review panel is loaded only after explicit inspection intent.
 *
 * A request revision prevents an earlier dynamic import from reopening the
 * panel after a second shortcut, a close request or Viewer disposal.
 */
export function createViewerInspectorController({
  document,window,readOnly,createPanel,closeMobileSheets=()=>{},
  inspectRequested=false,debugEnabled=false,onError=()=>{},
}={}) {
  if(!document||!window||readOnly!==true||typeof createPanel!=='function')
    throw new TypeError('Viewer inspector requires a read-only document and a lazy review-panel factory.');
  const primary=document.getElementById('reviewPanelBtn');
  const mobile=document.getElementById('mobileReviewBtn');
  const surface=document.getElementById('reviewPanel');
  if(!primary||!surface)throw new TypeError('Viewer inspector controls are missing.');

  let disposed=false,panel=null,loading=null,requestRevision=0,wantsOpen=false;
  const subscriptions=[];
  const listen=(node,event,handler,options)=>{
    node?.addEventListener(event,handler,options);
    subscriptions.push(()=>node?.removeEventListener(event,handler,options));
  };
  const reveal=()=>{
    if(disposed)return;
    primary.hidden=false;
    if(mobile)mobile.hidden=false;
  };
  if(inspectRequested||debugEnabled)reveal();

  function ensurePanel() {
    if(panel)return Promise.resolve(panel);
    if(!loading)loading=Promise.resolve().then(()=>disposed?null:createPanel()).then(candidate=>{
      if(disposed){candidate?.dispose?.();return null;}
      if(!candidate||typeof candidate.open!=='function'||typeof candidate.close!=='function'
        ||typeof candidate.dispose!=='function'||typeof candidate.syncMapSelection!=='function')
        throw new TypeError('The lazy inspector must expose the read-only review panel contract.');
      panel=candidate;
      return candidate;
    }).catch(error=>{loading=null;throw error;});
    return loading;
  }
  async function open(button=primary,{tab='changes'}={}) {
    if(disposed)return false;
    const revision=++requestRevision;
    wantsOpen=true;
    let active;
    try{active=await ensurePanel();}
    catch(error){
      if(revision===requestRevision)wantsOpen=false;
      throw error;
    }
    if(disposed||revision!==requestRevision||!wantsOpen||!active)return false;
    active.open(button,{tab});
    if(button===mobile)closeMobileSheets();
    return true;
  }
  function close() {
    if(disposed)return false;
    requestRevision++;
    wantsOpen=false;
    panel?.close();
    return true;
  }
  function reportFailure(error,message,code){onError(error,message,code);}
  function handled(task,message,code) {
    return task.catch(error=>{reportFailure(error,message,code);return false;});
  }
  function toggleFromShortcut() {
    reveal();
    if((panel&&!surface.hidden)||(!panel&&wantsOpen)){close();return;}
    void handled(open(primary,{tab:'map'}),'점검기를 열지 못했습니다.','PL-VIEWER-INSPECTOR-START');
  }
  const shortcut=event=>{
    if(event.repeat||!(event.ctrlKey||event.metaKey)||!event.shiftKey||event.code!=='Period')return;
    event.preventDefault();
    toggleFromShortcut();
  };
  listen(document,'keydown',shortcut);
  for(const button of [primary,mobile])if(button)listen(button,'click',()=>{
    void handled(open(button),'검수 화면을 열지 못했습니다.','PL-E4-REVIEW-START');
  });
  return Object.freeze({
    open,close,reveal,
    openAfterStartup:()=>inspectRequested
      ?handled(open(primary,{tab:'map'}),'점검기를 열지 못했습니다.','PL-VIEWER-INSPECTOR-START')
      :Promise.resolve(false),
    syncMapSelection:snapshot=>{if(!disposed)panel?.syncMapSelection(snapshot);},
    get isLoaded(){return panel!==null;},
    dispose(){
      if(disposed)return;
      disposed=true;
      wantsOpen=false;
      requestRevision++;
      for(const unsubscribe of subscriptions.splice(0))unsubscribe();
      // If a dynamic import is still resolving, ensurePanel's disposed branch
      // disposes its candidate without ever attaching it to the Viewer.
      panel?.dispose();
      panel=null;
    },
  });
}
