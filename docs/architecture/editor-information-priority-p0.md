# Editor Information Priority P0

이 문서는 `work/ui`의 편집 Surface(`#editorSurface`)를 기준으로 현재 DOM과 UI 기능의 **표시 우선순위만 분류**한다.

P0의 범위는 정보 위계 인벤토리 작성까지다. HTML 구조, CSS 배치, JS 동작, GIS/렌더링/저장 연산은 변경하지 않는다. 이후 P1~P3에서 실제 표시 구조를 바꿀 때 이 분류를 기준으로 사용한다.

기준 스냅샷: `work/ui` @ `e5a8d8373df56078cb91bfa6efd5c332ef4d02bb`

## 1. 네 등급

| 등급 | 의미 | 표시 원칙 |
| --- | --- | --- |
| P0-A 항상 필요 | 편집 Surface가 존재한다는 사실과 선택 유무를 전달하는 최소 shell | 편집창이 열리면 유지. 내용은 최소화 |
| P0-B 선택 객체에서만 필요 | 선택한 객체의 정체성, 속성, 관계, 가능한 명령 | 선택이 있을 때만 표시. 객체 종류에 따라 조건부 공개 |
| P0-C 특정 작업에서만 필요 | 경계/해안선/합병/분할/그리기/좌표 편집처럼 작업 모드에 진입한 뒤 필요한 단계 정보와 조작 | 작업 시작 시 B를 대체하거나 우선. 작업 종료 즉시 제거 |
| P0-D 오류 때만 필요 | 검증 실패, 잠금/조건 불충족, 계산 실패, 로드 실패, 재시도 등 정상 흐름을 막는 정보 | 정상 상태에서는 시각적 공간을 차지하지 않음. 발생 시 해당 조작 근처에만 표시 |

여기서 "항상 필요"는 모든 순간 화면에 텍스트를 계속 노출한다는 뜻이 아니라 **편집 Surface의 기본 계층에 속한다**는 뜻이다. 마찬가지로 동일 DOM이 정상 상태와 오류 상태를 함께 표현하는 경우 DOM의 주 소유 등급과 오류 상태 등급을 따로 적는다.

## 2. P0-A — 편집 Surface 기본 shell

사용자가 객체를 선택하지 않았어도 필요한 최소 구조다.

### DOM

- `#editorSurface` — 편집 Surface 자체
- `.surface-header` — 모바일 sheet handle의 소유 영역
- `[data-sheet-handle="editorSurface"]` — 모바일에서만 필요한 높이 조절
- `#editSheetTitle` — 접근성용 편집 Surface 이름
- `#editorScrollBody` / `.surface-content-editor` — 단일 본문 스크롤 소유자
- `#emptyProperties` — 선택 없음 상태의 유일한 본문 안내

### 기능

- Surface open/close 및 wide/compact/mobile 배치
- 편집창 본문 스크롤
- 선택 없음 상태 표시
- 모바일 sheet 높이 전환

### P0 판단

- 선택이 없을 때는 `#emptyProperties` 이외의 객체 정보/작업 정보를 노출할 필요가 없다.
- `#editorTimelineContext`는 기본 shell이 아니라 작업 컨텍스트에서 갱신되므로 P0-C로 분류한다.
- 객체명, 잠금, 표시 여부, 삭제 등은 A에 두지 않는다.

## 3. P0-B — 선택 객체 컨텍스트

선택 객체가 하나 이상 있을 때만 필요한 정보다. 이 등급의 기능은 작업 모드에 들어가기 전의 Inspector를 구성한다.

### 3.1 공통 객체 헤더

- `#editorObjectHeader`
- `#editorObjectHeading`
- `#propertyTitle`
- `#propertyTypeLabel`
- `#editorObjectStatus` — 잠김/숨김 같은 선택 객체 상태
- `#focusSelectedObjectBtn`
- `#objectVisibilityBtn`, `#objectVisibilityIcon`
- `#objectLockBtn`, `#objectLockIcon`
- `#flagMenuBtn`, `#flagPreview` — 영토 객체에만 조건부
- `#flagMenu`
- `#flagLibraryBtn`, `#flagUploadBtn`, `#flagDefaultBtn`, `#flagRemoveBtn`
- `#flagFileInput`

선택한 객체의 정체성을 설명하는 최소 정보는 객체명 + 종류다. 잠김/숨김 상태는 상태가 있을 때만 보조 정보로 필요하다. 국기 관리, 지도에서 보기, 표시/잠금 명령은 선택 객체에 대한 보조 명령으로 B에 속한다.

### 3.2 객체 편집 탭

- `.editor-view-tabs`
- `#editorTabBtn`
- `#actionsTabBtn`
- `#relationTabBtn`

현재 DOM은 정보 / 편집 / 관계를 가진다. P0에서는 구조를 바꾸지 않으며, 세 탭 모두 **선택 객체가 있을 때만 의미가 있는 B 계층**으로 분류한다.

### 3.3 다중 선택

- `#multiProperties`
- `#multiPropertiesColorLabel`
- `#multiPropertiesColorTrigger`, `#multiPropertiesColorValue`, `#multiPropertiesColorInput`, `#multiPropertiesColorPopover`
- `#multiCountryActions`
- `#multiSubunitMergeBtn`
- `#multiBorderEditBtn`

다중 선택 색상과 공통 작업은 B다. 다중 선택을 실제 국경/경계 편집 작업으로 전환한 뒤의 단계 UI는 C다.

### 3.4 영토 객체

기본 속성:

- `#entityProperties`
- `#entityAreaValue` — 현재는 숨김 메타데이터
- `#entityNameInput`
- `#entityNameDetailsDisclosure`, `#entityNameDetails`
- `#entityColorLabel`, `#entityColorTrigger`, `#entityColorValue`, `#entityColorInput`, `#entityColorPopover`
- `#entityPeriodInput`
- `#entityNotesInput`

선택 객체에서 시작 가능한 명령:

- `#annexEntityBtn`
- `#mergeEntityBtn`
- `#editEntityBorderBtn`
- `#redrawEntityBtn`
- `#editEntityCoastBtn`
- `#reconcileEntityCoastBtn`
- `#copyEntityRegionBtn`

관계:

- `#entityRelations`
- `#entityChangeParentBtn`, `#entityParentRows`, `#entityParentRow`, `#entityParentInput`
- `#entityAddChildBtn`, `#entityChildRows`, `#entityChildRow`, `#entityChildInput`
- `#entityRegionalStatus`
- JS에서 동적 생성되는 `.editor-relation-row`, 관계 focus/remove 버튼

위 명령 버튼은 작업을 **시작하는 진입점**이므로 B다. 버튼을 누른 뒤 나타나는 대상 선택, 그리기, 검토, 적용 UI는 C로 넘어간다.

### 3.5 분포

- `#distributionProperties`
- `#distributionNameInput`
- `#distributionUnitInput`
- `#distributionColorLabel`, `#distributionColorTrigger`, `#distributionColorValue`, `#distributionColorInput`, `#distributionColorPopover`
- `#distributionValueScaleInput`
- `#distributionManualScaleFields`, `#distributionValueMinInput`, `#distributionValueMaxInput`
- `#distributionParentInput`
- `#distributionRenderModeInput` — 현재 hidden native state
- `#distributionEntryList`
- 동적 `.distribution-entry-row` 및 값 입력/삭제 버튼
- `#distributionTerritorialUnitInput`
- `#distributionValueUnit`
- `#distributionValueInput`
- `#addTerritorialDistributionBtn`
- `#addGeometryDistributionBtn`

직접 영역 분포 추가는 B 안에서 끝나지만, `#addGeometryDistributionBtn`으로 자유 영역 그리기를 시작한 뒤의 그리기/완료 UI는 C다.

### 3.6 Generic Feature

- `#genericFeatureProperties`
- `#genericFeatureConversionSection`
- `#genericFeatureConvertType`
- `#genericFeatureConvertParentField`, `#genericFeatureConvertParentInput`
- `#genericFeatureConvertDistributionField`, `#genericFeatureConvertDistributionInput`
- `#genericFeatureConvertDistributionValueField`, `#genericFeatureConvertDistributionValueInput`
- `#convertGenericFeatureBtn`
- `#genericFeatureIdInput` — 현재 숨김 메타데이터

종류 변경에 필요한 조건부 필드는 모두 선택 객체 자체의 의미를 정하는 것이므로 B다.

### 3.7 지명

- `#labelProperties`
- `#labelNameInput`
- `#labelKindInput`
- `#labelPositionValue`
- `#labelBuiltinInfo`
- `#labelBuiltinSource`
- `#labelBuiltinId`
- `[data-od-id="label-details"]`, `#labelNotesInput`
- `#copyPlaceSection`, `#copyPlaceBtn`

내장 지명의 원본 수정 불가 안내, 출처, 현대명 불확실성 안내는 선택한 지명의 성격을 설명하므로 B다. 단, 실제 로드 실패나 저장 실패 메시지는 D다.

### 3.8 강·호수

- `#hydroProperties`
- `#hydroEditFields`
- `#hydroNameInput`
- `#hydroColorLabel`, `#hydroColorTrigger`, `#hydroColorValue`, `#hydroColorInput`, `#hydroColorPopover`
- `[data-od-id="hydro-details"]`, `#hydroNotesInput`
- `#hydroBuiltinNotes`, `#hydroBuiltinNotesInput`
- `#hydroCategoryValue`
- `#hydroBuiltinHelp`, `#hydroSourceValue`
- `#hydroVerticesBtn`
- `#copyHydroBtn`
- `#hydroIdLabel`, `#hydroIdValue`, `#hydroSystemRow`, `#hydroSystemValue`, `#hydroTributaryValue` — 현재 숨김 데이터 정보 포함

`#hydroVerticesBtn`은 좌표 편집 진입점이므로 B다. 좌표 편집 중 정점 조작과 완료 흐름은 C다.

### 3.9 삭제

- `#editorDeleteSection`
- `#objectDeleteBtn`

삭제 진입점은 선택 객체에 대한 명령이므로 B다. 잠금/삭제 불가 사유는 D 상태로만 승격한다. 삭제 확인 dialog 자체는 `#editorSurface` 바깥의 공통 dialog 소유다.

### 3.10 B를 소유하는 주요 기능

`object-property-controller.js`

- `activeForm`
- `syncActionTab`
- `show`
- `areaSuffix`
- `distributionEntryLabel`
- `renderDistributionEntries`
- `presentDistribution`
- `syncGenericSemanticEditor`
- `presentGeneric`
- `presentLabel`
- `presentHydro`
- `present`

`territorial-property-controller.js`

- `presentRelations`
- `presentFields`
- `syncRelationPicker`, `closeRelationPicker`
- `renderFlag`, `syncIdentity`, `syncInteraction`, `positionFlagMenu`
- 필드/관계/국기 변경 event binding
- `formatTerritorialPeriodInput`

`app-object-commands.js`

- `objectBatchCapabilities`, `commonBatchCapabilities`, `objectRefLocked`
- `syncBatchActionAvailability`
- `batchSetVisibility`, `batchSetLocked`, `batchToggleLocked`, `batchSetColor`
- `syncObjectActionsMenu`, `openObjectActionsMenu`, `closeObjectActionsMenu`, `positionObjectActionsMenu`
- `deleteSelectedFromObjectMenu`, `requestObjectDeletion`

`app-property-selection.js`

- `setEditorShellView`
- `replaceSelectOptions`
- `territorialRootOptions`, `territorialParentOptions`
- `distributionLayerById`, `distributionEntryLabel`
- `commitDistributionMeta`
- `addTerritorialDistributionEntry`, `removeDistributionEntry`, `updateDistributionEntryValue`
- `deleteDistributionLayer`, `setDistributionLayerVisible`
- `setTerritorialEntityName`, `setTerritorialEntityColor`, `setTerritorialEntityLocked`
- `copySelectedHydroForEditing`
- `applyTerritorialSelectionIntent`, `applyDistributionSelectionIntent`, `applyGenericSelectionIntent`, `applyLabelSelectionIntent`, `applyHydroSelectionIntent`

`createDistributionLayerFromPrompt`은 새 분포 생성 흐름이고 편집 Surface 외부 진입점과 연결되므로 P0 편집창 핵심 목록에서는 보조 경계로 취급한다.

## 4. P0-C — 작업 모드 전용

아래 요소는 평상시 객체 Inspector에 상시 존재할 이유가 없다. 경계 조정, 해안선 조정, 합병/분할, 영역 편입, 새 영토 선택, 강·호수 그리기, 좌표 편집 등 특정 작업이 활성화된 동안만 필요하다.

### 4.1 작업 Surface 전환

- `#editorTaskSlot`
- `#modeEditingContext`
- `#modeEditingHud`
- `#modeTaskWindowContent`
- `#modeTaskMinimizeBtn`
- `#editorTimelineContext`

`editor-workspace-presentation.js`의 `createEditorWorkspacePresentation`은 `data-editor-content="properties" / "task"` 전환과 task slot 표시를 소유한다. 작업이 활성화되면 편집창의 정보 계층은 B보다 C가 우선한다.

### 4.2 작업 정체성과 단계

- `#modeTaskName`
- `#modeTaskStage`
- `#modeTaskStep`
- `#modeTaskStatus` — preparing/invalid 상태는 D 오버레이도 가짐
- `#modeTaskTargetSummary`
- `#modeTaskEditingStage`
- `#modeTaskInput`

사용자가 한 순간에 반드시 알아야 할 핵심은 **작업명 / 현재 단계 / 현재 해야 할 행동**이다. target summary, step, 상태는 작업 종류와 단계에 따라 조건부다.

### 4.3 작업 세부 컨텍스트

- `#modeTaskViewTime`
- `#modeTaskPeriod`
- `#modeTaskAffectedSummary`
- `#modeTaskAffectedList`
- `#modeTaskObjects` 및 JS 동적 `.workflow-object-card`

보기 시점, 변경 기간, 영향 대상은 검토/확인이 필요한 단계에서만 C에 노출한다. 작업 대상 카드가 같은 정보를 이미 설명하면 중복 표시하지 않는 현재 로직을 유지한다.

### 4.4 영토 생성/편입 setup

- `#territorialCreateSetup`
- `#territorialCreateNameLabel`, `#territorialCreateNameInput`
- `#territorialCreateKindRow`, `#territorialCreateRegionalInput`
- `#territorialCreateParentRow`, `#territorialCreateParentInput`
- `#territorialCreateSourceRow`, `#territorialCreateSourceInput`
- `#territorialCreateReference`
- `#territorialCreateReferenceLabel`, `#territorialCreateReferenceCount`, `#territorialCreateReferenceList`
- `#territorialReferenceStartBtn`
- 동적 `.territorial-create-reference-chip`

### 4.5 영역 선택 방식

- `#modeMethodSwitch`
- `#modeDirectLineMethodInput`
- `#modePolygonMethodOption`, `#modePolygonMethodInput`
- `#modeComponentsMethodInput`
- `#modeMethodChangeConfirm`
- `#modeMethodChangeConfirmMessage`
- `#modeMethodChangeKeepBtn`, `#modeMethodChangeConfirmBtn`
- `#modeRiverBoundaryOption`, `#modeRiverBoundaryInput`

방식 선택 및 방식 변경 확인은 해당 작업에서만 의미가 있다.

### 4.6 그리기/정점 조작

- `#vertexPlacementBtn`
- `#modeDraftActions`
- `#modeDraftInsertBtn`
- `#modeDraftDeleteBtn`
- `#modeDraftRedrawBtn`
- `#modeDraftDoneBtn`

그리기 가능한 단계에서만 C다. draft가 없거나 검토 단계로 넘어가면 제거한다.

### 4.7 선택/결과/검토

- `#territorySelectionStack`, `#territorySelectionStackSummary`, `#territorySelectionStackList`
- JS 동적 `.workflow-result-row` 및 제거 버튼
- `#modeTaskResults`, `#modeTaskResultsSummary`, `#modeTaskResultsList`
- `#multiDrawnActions`, `#multiDrawnAddBtn`, `#multiDrawnUndoBtn`
- `#geometryPreviewSummary`

결과가 0개이고 정상적으로 아직 입력을 기다리는 단계라면 빈 결과 panel을 상시 노출하지 않는다.

### 4.8 작업 피드백 및 실행

- `#modeTaskFeedback`
- `#modeTaskInstruction` — 정상 작업 지시문은 C, 오류 문구는 D
- `#modeTaskCandidateFeedback`
- `#modeActionBar`
- `#modeReturnBtn`
- `#modeCancelBtn`, `#modeCancelIcon`
- `#modePrimaryBtn`, `#modePrimaryIcon`

완료/다음/적용/미리보기 등의 primary action은 작업 단계의 핵심 C다. `다시 시도`로 바뀌는 실패 복구 상태는 D다.

### 4.9 C를 소유하는 주요 기능

`app-task-presentation.js`

- `draftToolbarStatus`
- `multiDraftReviewActive`
- `syncCountryActionButtons`
- `setModeBanner`
- `syncCutDraftFeedback`
- `activeModeTaskDescriptor`
- `countryDisplay`, `displayObject`, `mergeReviewTargets`, `appendIdentity`
- `syncGeometryPreviewSummary`
- `mapModeContextActive`
- `syncMapHudBounds`, `syncMapContextSurfaces`, `toggleMapTaskWindow`, `syncMapCursorMode`
- `syncTerritorySetup`
- `syncTerritorySelectionStack`
- `territorialUnitDisplay`
- `syncTaskResults`
- `setButtonLabel`, `syncTaskActionDescription`, `syncTaskStatus`
- `syncEditingContext`
- `currentTaskTargets`, `syncTaskObjectCards`
- `modeActionContext`, `modePrimaryCommand`, `updateModeButtons`
- `dispatchModePrimaryAction`, `runModePrimaryAction`
- `cancelCurrentEditing`, `returnToEditing`, `completeCurrentDraft`

`editor-workspace-presentation.js`

- `createEditorWorkspacePresentation`

`app-property-selection.js`

- `startGeometryDistributionDraft` — B의 분포 편집에서 C 작업 모드로 전환

## 5. P0-D — 오류/차단/복구 전용

D는 새로운 독립 panel을 의미하지 않는다. 기존 B/C 컨트롤이 정상 흐름을 진행할 수 없을 때만 보조 정보가 나타나는 상태다.

### 5.1 명시적 DOM

- `#multiBorderEditHelp` — 선택 조합이 유효하지 않거나 잠긴 객체가 있을 때만
- `#modeTaskDisabledReason` — primary/draft action을 진행하지 못하는 이유
- `#modeTaskStatus[data-task-state="invalid"]`
- `#modeTaskInstruction.cut-invalid`
- `#modeTaskFeedback`의 오류 상태
- `#modePrimaryBtn`의 `다시 시도` 상태
- `#territorySelectionStackSummary`의 `계산 실패`
- `#modeTaskResultsSummary`의 `검증 필요`
- `#entityPeriodInput[aria-invalid="true"]` 및 native validity message

### 5.2 오류지만 별도 DOM을 만들지 않는 상태

- 잠금 때문에 수정/삭제/국경 조정이 불가능한 경우
- 잘못된 존속기간
- 분포 값/설정 검증 실패
- 객체 또는 전체 수계 형상을 찾지 못한 경우
- 수계 전체 형상 로드 실패
- 경계 준비/계산 실패
- preview validation blocking
- 편집 command 적용 실패
- 국기 파일 읽기/적용 실패
- 삭제 직전 상태가 바뀌어 작업이 중단된 경우

이 상태들은 공통 `setActionStatus`, `reportOperationError`, native validity, 기존 task feedback을 사용하며 정상 화면에 영구 설명을 추가하지 않는다.

### 5.3 D에 해당하는 주요 기능/분기

- `territorial-property-controller.js`: `parseTerritorialPeriodInput`, 기간 입력 validity 처리, `reportEditError`, `reportFlagError`
- `app-object-commands.js`: `requireObjectsUnlocked`, `syncBatchActionAvailability`의 invalid/locked reason, 삭제 중단/실패 처리
- `object-property-controller.js`: `reportOperationError` 기반 hydro property load 실패
- `app-property-selection.js`: 분포 검증/잠금/복사 실패의 `setActionStatus` / `reportOperationError`
- `app-task-presentation.js`: `syncTaskStatus`, `syncCutDraftFeedback`, `modePrimaryCommand`의 retry/disabled reason, `runModePrimaryAction` catch

## 6. 중복 정보 판정

P1 이후에는 아래 중복을 우선적으로 줄인다. P0에서는 코드나 표시를 변경하지 않는다.

1. 객체 헤더의 객체 상태와 각 작업 행의 잠금 사유가 동시에 같은 내용을 반복하지 않도록 한다.
2. 작업 중 `modeTaskTargetSummary`, `modeTaskObjects`, `modeTaskAffectedList`, `geometryPreviewSummary`가 동일 대상을 반복하면 한 곳만 주 표시로 남긴다.
3. `modeTaskStage`, `modeTaskEditingStage`, `modeTaskInstruction`, `modeTaskDisabledReason`이 같은 행동 지시를 반복하면 현재 단계의 1개 문장만 시각적으로 우선한다.
4. 정상 상태의 설명은 B/C에 남기되, 오류/차단 이유는 D로 분리해 정상 시 공간을 차지하지 않게 한다.
5. 숨김 메타데이터(`entityAreaValue`, `genericFeatureIdInput`, hydro 데이터 정보)는 P1에서 다시 상시 노출하지 않는다.

## 7. P0 완료 조건

- `#editorSurface`의 의미 있는 정적 DOM을 A/B/C/D 중 주 등급으로 분류했다.
- JS가 동적으로 만드는 관계 행, 분포 행, 작업 대상 카드, 선택/결과 행도 포함했다.
- 편집창을 소유하는 주요 presentation/property/command 함수의 책임을 B/C/D와 연결했다.
- 기능 삭제 없음.
- HTML/CSS/JS 변경 없음.
- GIS/renderer/저장 schema 변경 없음.
- P0 자체는 문서 인벤토리이므로 전체 브라우저 회귀검사를 요구하지 않는다.
