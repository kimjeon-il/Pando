import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'), write=(p,s)=>fs.writeFileSync(p,s);
const block=(s,a,b,value)=>{const start=s.indexOf(a),end=s.indexOf(b,start);if(start<0||end<0)throw Error(a);return s.slice(0,start)+value+s.slice(end);};
let p='index.html',s=read(p);
s=block(s,'            <div id="subunitToolbarFields"','            <button id="objectVisibilityBtn"','');
s=block(s,'          <form id="countryProperties"','          <form id="distributionProperties"',`          <form id="entityProperties" class="editor-view editor-object-form hidden" onsubmit="return false;">
            <div class="editor-country-area" aria-hidden="true" hidden><strong id="entityAreaValue">—</strong></div>
            <section class="editor-section editor-info-section editor-section-primary" aria-label="정보">
              <div class="ui-field field-group editor-field"><label for="entityNameInput">이름</label><input id="entityNameInput" type="text" autocomplete="off" /></div>
              <div class="ui-field field-group editor-field"><label for="entityNotesInput">메모</label><textarea id="entityNotesInput" rows="5" placeholder="객체에 관한 메모를 입력하세요."></textarea></div>
              <fieldset class="editor-period-group"><legend>유효 기간</legend><div class="editor-period-fields">
                <div class="ui-field field-group editor-field"><label for="entityValidFromInput">시작일</label><input id="entityValidFromInput" type="text" inputmode="numeric" placeholder="예: 1910-01-01" /></div>
                <div class="ui-field field-group editor-field"><label for="entityValidToInput">종료일</label><input id="entityValidToInput" type="text" inputmode="numeric" placeholder="현재까지면 비워 둠" /></div>
              </div></fieldset>
            </section>
            <section class="editor-section editor-action-section" aria-label="편집"><div class="editor-action-list">
              <button id="addEntityChildBtn" type="button" class="ui-button editor-action-row"><span><strong>하위 객체 추가</strong><small>이 객체를 상위 객체로 지정하여 추가</small></span></button>
              <button id="annexEntityBtn" type="button" class="ui-button editor-action-row"><span><strong>영역 편입</strong><small>다른 객체의 영역 가져오기</small></span></button>
              <button id="mergeEntityBtn" type="button" class="ui-button editor-action-row"><span><strong>객체 합병</strong><small>연결된 객체들을 하나로 합치기</small></span></button>
              <button id="editEntityBorderBtn" type="button" class="ui-button editor-action-row"><span><strong>경계 조정</strong><small>접한 객체 사이의 공유 경계 편집</small></span></button>
              <button id="redrawEntityBtn" type="button" class="ui-button editor-action-row"><span><strong>영역 다시 지정</strong><small>독립 권역의 형상 다시 그리기</small></span></button>
              <button id="editEntityCoastBtn" type="button" class="ui-button editor-action-row"><span><strong>해안선 조정</strong><small>바다와 맞닿은 경계 편집</small></span></button>
              <button id="reconcileEntityCoastBtn" type="button" class="ui-button editor-action-row"><span><strong>해안선 정합</strong><small>상위 지도와 해안선 불일치 구간 조정</small></span></button>
              <button id="copyEntityRegionBtn" type="button" class="ui-button editor-action-row"><span><strong>독립 권역으로 복사</strong><small>원본 영역을 유지하고 새 객체 생성</small></span></button>
            </div></section>
            <section class="editor-section editor-action-section editor-relation-section" aria-label="관계">
              <div id="entityParentRow" class="ui-field field-group editor-field"><label for="entityParentInput">상위 객체</label><select id="entityParentInput"><option value="">상위 객체 없음</option></select></div>
              <p id="entityRegionalStatus" class="editor-help hidden">독립 권역 · 다른 객체와 겹칠 수 있으며 상위 객체를 갖지 않습니다.</p>
            </section>
          </form>

`);
s=block(s,'  <div id="territorialTypeModal"','  <div id="historicalLibraryModal"','');
s=s.replace(/\s*<button id="addCountryBtn"[^\n]+\n\s*<button id="addSubunitBtn"[^\n]+\n\s*<button id="addRegionBtn"[^\n]+/,'\n              <button id="addEntityBtn" data-map-object-type="entity" class="ui-button ui-menu-item" role="menuitem" tabindex="-1" type="button"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-territory"/></svg><span>객체</span></button>');
s=s.replace(/\s*<label id="territorialCreateSovereignRow"[^\n]+/,'');
s=s.replace('<span>상위 단위</span><select id="territorialCreateParentInput">','<span>상위 객체</span><select id="territorialCreateParentInput">');
s=s.replace('                    <label id="territorialCreateParentRow"','                    <label id="territorialCreateKindRow" class="ui-field field-group"><span class="ui-check-row"><input id="territorialCreateRegionalInput" type="checkbox" /><span>독립 권역으로 만들기</span></span></label>\n                    <label id="territorialCreateParentRow"');
s=s.replaceAll('countryToolbarFields','entityToolbarFields').replaceAll('data-selection-kind="country"','data-selection-kind="entity"').replaceAll('data-color-picker="country"','data-color-picker="entity"').replaceAll('countryColor','entityColor').replace('국가 색상 팔레트','객체 색상 팔레트');
write(p,s);
// Runtime selector renames. Removed forms have no alternative selectors.
const ids={countryNameInput:'entityNameInput',countryColorInput:'entityColorInput',countryColorTrigger:'entityColorTrigger',countryColorPopover:'entityColorPopover',countryAreaValue:'entityAreaValue',notesInput:'entityNotesInput',annexTerritoryBtn:'annexEntityBtn',mergeCountryBtn:'mergeEntityBtn',editBorderBtn:'editEntityBorderBtn',editCoastBtn:'editEntityCoastBtn',editSubunitCoastBtn:'editEntityCoastBtn',reconcileSubunitCoastBtn:'reconcileEntityCoastBtn',subunitParentInput:'entityParentInput'};
for(const file of fs.readdirSync('assets/js/modules').filter(f=>f.endsWith('.js'))){p='assets/js/modules/'+file;s=read(p);for(const[a,b]of Object.entries(ids))s=s.replaceAll(a,b);write(p,s);}
p='assets/js/modules/app-tool-bindings.js';s=read(p);s=block(s,"    (0, dependencies.platform.$)('addCountryBtn')", "    (0, dependencies.platform.$)('addDistributionBtn')",`    dependencies.platform.$('addEntityBtn').addEventListener('click', () => {
      dependencies.genericEditingB.requestDraftDiscard(() => dependencies.workspaceUiA.completeToolStart(
        dependencies.territorialEditingA.enterTerritorialCreateWorkflow(), { destination: 'editor' }));
    });
`);
s=s.replace(/    \(0, dependencies\.platform\.\$\)\('territorialCreateSovereignInput'\)[^\n]+\n/,"    dependencies.platform.$('territorialCreateRegionalInput').addEventListener('change', event => dependencies.territorialEditingB.updateTerritorialCreateKind(event.currentTarget.checked));\n");
s=block(s,"    (0, dependencies.platform.$)('annexEntityBtn')", "    (0, dependencies.platform.$)('resetViewBtn')",'');write(p,s);
p='assets/js/modules/app-task-presentation.js';s=read(p);s=block(s,"    for (const id of ['territorialCreateSovereignRow'", "    const reference =", `    if (model?.showSetup) {
      const name = dependencies.platform.$('territorialCreateNameInput');
      if (name.value !== selection.name) name.value = selection.name;
      name.closest('.field-group').classList.toggle('hidden', !!selection.editOperation);
      const setupModel = dependencies.territorialEditingB.territorialCreateSetupModel();
      const regional = dependencies.platform.$('territorialCreateRegionalInput');
      regional.checked = selection.entityKind === 'regional';
      regional.disabled = !!selection.editOperation;
      const parent = dependencies.platform.$('territorialCreateParentInput');
      dependencies.propertyEditingB.replaceSelectOptions(parent, setupModel.parentOptions, selection.parentId);
      parent.disabled = regional.checked || !!selection.editOperation;
      const source = dependencies.platform.$('territorialCreateSourceInput');
      const choice = dependencies.propertyEditingB.replaceSelectOptions(source, setupModel.sourceOptions, selection.sourceKey, { autoSelectSingle: true });
      source.disabled = !!setupModel.session.setupSourceCache?.pending;
      dependencies.platform.$('territorialCreateSourceRow').classList.toggle('hidden', !selection.parentId || choice.single);
    }
`);write(p,s);
