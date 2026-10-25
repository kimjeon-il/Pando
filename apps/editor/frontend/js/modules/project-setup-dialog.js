import {normalizeProjectSetup,boundsFromCorners} from "../../../../../shared/frontend/js/modules/project-setup.js";
import {timelineMonthLabel} from "../../../../../shared/frontend/js/modules/timeline-controls.js";
/** Form values are disposable inputs; accepted settings are always read from ProjectDomain. */
export function createProjectSetupDialog({document,createProject,confirmDiscard,getViewportBounds,screenToGeo,describeSource}) {
 const dialog=document.getElementById('projectSetupDialog'),form=document.getElementById('projectSetupForm');
 const el=id=>document.getElementById('projectSetup'+id);let pending=false,bounds=null,sourceRequest=0,drawCleanup=null;
 const error=reason=>{el('Error').textContent=String(reason?.message||reason);};
 function read(){return normalizeProjectSetup({initialMonth:el('Month').value.trim(),timelineRange:el('Limited').checked?{start:el('Start').value.trim(),end:el('End').value.trim()}:null,initialMapBounds:bounds,sourceMode:el('Source').value});}
 async function summary(){const request=++sourceRequest;try{const setup=read();el('Error').textContent='';el('Summary').textContent='시작: '+timelineMonthLabel(setup.initialMonth)+' 말\n탐색 기간: '+(setup.timelineRange?timelineMonthLabel(setup.timelineRange.start)+'–'+timelineMonthLabel(setup.timelineRange.end):'제한 없음')+'\n초기 지도 범위: '+(bounds?'지정한 영역 (객체를 자르지 않음)':'전 세계')+'\n시작 자료: '+(setup.sourceMode==='empty'?'빈 지도':'내장 지도');
 el('Coverage').textContent=setup.sourceMode==='empty'?'객체와 시간 기록 없이 시작합니다.':'해당 시점 자료 확인 중…';if(setup.sourceMode==='builtin'){const description=await describeSource(setup.initialMonth);if(request===sourceRequest)el('Coverage').textContent=description;}}
 catch(reason){if(request===sourceRequest)error(reason);}}
 function lock(value){pending=value;for(const control of form.elements)control.disabled=value;dialog.setAttribute('aria-busy',String(value));}
 const close=()=>{if(pending)return;sourceRequest++;drawCleanup?.();drawCleanup=null;dialog.close();};
 function open(){if(pending)return;
 const now=new Date(),month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
 el('Month').value=month;el('Limited').checked=false;el('Start').value=month;el('End').value=month;
 el('Range').hidden=true;bounds=null;el('Bounds').value='world';el('Source').value='builtin';
 dialog.showModal();summary();}
 form.addEventListener('input',()=>{el('Range').hidden=!el('Limited').checked;summary();});
 el('Bounds').addEventListener('change',()=>{try{if(el('Bounds').value==='world')bounds=null;else if(el('Bounds').value==='current')bounds=getViewportBounds();summary();}catch(reason){error(reason);}});
 el('Draw').addEventListener('click',()=>{if(pending)return;dialog.close();const map=document.getElementById('map'),overlay=document.createElement('div');overlay.className='project-bounds-picker';overlay.tabIndex=0;overlay.setAttribute('role','application');overlay.setAttribute('aria-label','사각형 범위를 드래그하세요. Esc로 취소');overlay.textContent='지도를 드래그하여 시작 범위 지정 · Esc 취소';const box=document.createElement('div');box.className='project-bounds-box';overlay.append(box);map.append(overlay);let start=null,pointer=null;
 const finish=()=>{overlay.remove();drawCleanup=null;dialog.showModal();summary();};drawCleanup=finish;
 overlay.addEventListener('pointerdown',event=>{if(pointer!==null)return;pointer=event.pointerId;overlay.setPointerCapture(pointer);start=[event.offsetX,event.offsetY];event.preventDefault();});
 overlay.addEventListener('pointermove',event=>{if(event.pointerId!==pointer||!start)return;const r=overlay.getBoundingClientRect(),end=[event.clientX-r.left,event.clientY-r.top];box.style.display='block';box.style.setProperty('--bounds-left',Math.min(start[0],end[0])+'px');box.style.setProperty('--bounds-top',Math.min(start[1],end[1])+'px');box.style.setProperty('--bounds-width',Math.abs(start[0]-end[0])+'px');box.style.setProperty('--bounds-height',Math.abs(start[1]-end[1])+'px');});
 overlay.addEventListener('pointerup',event=>{if(event.pointerId!==pointer||!start)return;const r=overlay.getBoundingClientRect(),end=[event.clientX-r.left,event.clientY-r.top];try{if(Math.hypot(end[0]-start[0],end[1]-start[1])<12)throw new Error('범위를 더 크게 지정하세요.');bounds=boundsFromCorners(screenToGeo([Math.min(start[0],end[0]),Math.max(start[1],end[1])]),screenToGeo([Math.max(start[0],end[0]),Math.min(start[1],end[1])]));el('Bounds').value='custom';}catch(reason){error(reason);}finish();});
 overlay.addEventListener('pointercancel',finish);overlay.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish();}});overlay.focus();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});el('Cancel').addEventListener('click',close);
 form.addEventListener('submit',async event=>{event.preventDefault();if(pending)return;let setup;try{setup=read();}catch(reason){error(reason);return;}
 // A native modal dialog makes the external discard prompt inert. Release
 // the top layer before prompting, retaining the form on cancel or failure.
 lock(true);dialog.close();try{if(!await confirmDiscard()){dialog.showModal();return;}await createProject(setup);}
 catch(reason){dialog.showModal();error(reason);}finally{lock(false);}});
 return Object.freeze({open});
}
