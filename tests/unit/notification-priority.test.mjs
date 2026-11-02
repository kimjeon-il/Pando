import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationPresentation} from '../../shared/frontend/js/modules/notification-presentation.js';

function fixture(protectErrorNotices){
  const tokens=new Set(['hidden','ready']);
  const classList={
    add(...items){for(const name of items)tokens.add(name);},
    remove(...items){for(const name of items)tokens.delete(name);},
    contains(value){return tokens.has(value);},
  };
  const label={textContent:''};
  const notice={classList,dataset:{},aria:{},
    setAttribute(name,value){this.aria[name]=value;},
    querySelector(name){return name==='strong'?label:null;}};
  const body={classList:{add(){},remove(){}}};
  const presentation=createNotificationPresentation({document:{body},
    getElement:id=>id==='actionStatus'?notice:null,isMobile:()=>false,protectErrorNotices});
  return {presentation,notice,label};
}
test('E4 viewer keeps a user file-error alert visible over background Canvas success',()=>{
  const f=fixture(true);
  try{
    f.presentation.reportOperationError(new Error('invalid GPKG'),
      '프로젝트를 열지 못했습니다.','PL-FILE-IMPORT',4400);
    assert.ok(f.notice.classList.contains('error'));
    const prior=f.label.textContent;
    f.presentation.setActionStatus('Canvas 대체 지도를 표시했습니다.','success',1800);
    assert.ok(f.notice.classList.contains('error'));
    assert.equal(f.label.textContent,prior);
    assert.equal(f.notice.aria.role,'alert');
    f.presentation.clearErrorNotification();
    f.presentation.setActionStatus('정상적으로 프로젝트를 불러왔습니다.','success',1800);
    assert.ok(f.notice.classList.contains('success'));
  }finally{f.presentation.dispose();}
});
test('E4 does not change existing editor notification overwrite semantics',()=>{
  const f=fixture(false);
  try{
    f.presentation.setActionStatus('파일 오류','error',4400);
    f.presentation.setActionStatus('새 프로젝트 확인','success',1800);
    assert.ok(f.notice.classList.contains('success'));
  }finally{f.presentation.dispose();}
});
test('forced user-facing success can explicitly replace a pending viewer error',()=>{
  const f=fixture(true);
  try{
    f.presentation.setActionStatus('파일 오류','error',4400);
    f.presentation.setActionStatus('새 프로젝트 확인','success',1800,{forceVisible:true});
    assert.ok(f.notice.classList.contains('success'));
  }finally{f.presentation.dispose();}
});
